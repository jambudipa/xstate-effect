---
title: How to give a machine's actions and actors Effect services
doc-type: how-to
sources: [packages/core/src/setup.ts, packages/core/src/Actor.ts, packages/core/src/Types.ts, packages/core/src/StateMachine.ts]
---

# How to give a machine's actions and actors Effect services

> **TL;DR:** Build the machine with `setup`. An action that returns an Effect, named in the setup
> or written inline in the config, and an actor built with `fromEffect` add the services their
> Effects need to the machine's requirements, so `createActor` asks for them beside `Scope`.
> Provide them with `Effect.provideService` or a `Layer` around the Effect that calls
> `createActor`. The actor keeps the services it was created with, and every action (the initial
> entry actions included) and every child actor receives them.

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
Effect that `createActor` returns. An action written inline in the config counts in the same
way; see [Write the action inline, or replace it with `provide`](#write-the-action-inline-or-replace-it-with-provide).

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
and the actor reads the services when it starts. Logic written inline as the `src` of an
`invoke`, in a setup that has an `actors` record, counts too. The same holds for
`fromEffectBackground`, `fromEffectRetry` and `fromStream`, and for a child machine built with
`setup`.

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

### Write the action inline, or replace it with `provide`

An action written inline in the config of a `setup` machine adds the services of its Effect, in
any state and on any transition. `machine.provide` gives a new machine whose requirements also
hold the services of the implementations that you give it, so a replacement action that reads
another service makes `createActor` ask for that service too.

```ts
import { createActor, setup } from "@jambudipa/xstate-effect"
import { Context, Effect, type Scope } from "effect"

class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string, subject: string) => Effect.Effect<void>
}>()("app/Mailer") {}

class Audit extends Context.Service<Audit, {
  readonly record: (entry: string) => Effect.Effect<void>
}>()("app/Audit") {}

const signupMachine = setup({
  types: {} as { events: { readonly type: "CONFIRM" } },
  actions: { recordConfirmed: () => Effect.void }
}).createMachine({
  initial: "pending",
  states: {
    pending: {
      on: {
        CONFIRM: {
          target: "confirmed",
          actions: [
            // An inline action: the machine requires Mailer
            () =>
              Effect.gen(function* () {
                const mailer = yield* Mailer
                yield* mailer.send("user@example.com", "Confirmed")
              }),
            "recordConfirmed"
          ]
        }
      }
    },
    confirmed: { type: "final" }
  }
})

// The replacement action reads Audit: the new machine requires Mailer and Audit
const auditedMachine = signupMachine.provide({
  actions: {
    recordConfirmed: () =>
      Effect.gen(function* () {
        const audit = yield* Audit
        yield* audit.record("signup confirmed")
      })
  }
})

export const created: Effect.Effect<unknown, never, Scope.Scope | Mailer | Audit> = createActor(auditedMachine)
```

A replacement actor is different: it must have the type of the setup's logic of that name, so
one that needs another service is a type error.

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

The compiler tracks the services of a `setup` machine's named and inline actions and actors,
and of the implementations given to `machine.provide`. In these cases nothing asks you for the
service, and an Effect that reads a missing one fails with `Service not found`, which gives the
actor the status `error`:

- **`createMachine` without `setup`.** Its machine requires no services, whatever the Effects of
  its config's actions or of its `implementations` argument need. Use `setup` for a machine
  whose actions need services. Its `provide` still adds the services of what you give it.
- **Actions that `enqueueActions` enqueues.** The callback chooses them at run time, so their
  Effects add nothing to the requirements. Name such an action in `setup({ actions })` and
  enqueue it by name: the setup's record then carries its services.
- **Inline actions of an `initial` object or a `route`.** The `actions` of
  `initial: { target, actions }` and of a state's `route` add nothing. Name such an action in
  `setup({ actions })` and use its name there.

A guard cannot read a service: it may return an `Effect<boolean>`, but that Effect has no
requirements, and a guard whose Effect needs a service is a type error. A failure of an action's
Effect also gives the actor the status `error`; see
[How to handle actor errors](handle-actor-errors.md).

## Related

- [How services reach actions and actors](../explanation/services-and-requirements.md) — why
  the actor captures its services at creation.
- [createActor and the actor](../reference/create-actor.md) — the signatures of `createActor`
  and its requirements.
- [fromEffect, fromEffectBackground and fromEffectRetry](../reference/actors/from-effect.md) —
  Effect-based actor logic and its requirements.
- [setup and setupWithSchema](../reference/setup.md#requirements) — the requirements of a setup
  machine, and the `actions` and `actors` records.
- [machine.provide](../reference/create-machine.md#machineprovide) — the requirements that the
  given implementations add.
