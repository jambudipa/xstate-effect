---
title: How to run an Effect or a Stream as an actor
doc-type: how-to
sources: [packages/core/src/actors/fromEffect.ts, packages/core/src/actors/fromObservable.ts]
---

# How to run an Effect or a Stream as an actor

> **TL;DR:** Wrap an Effect in `fromEffect`, or a Stream in `fromStream`. Create the actor with
> `createActor(logic, { input })` inside a scope, then `yield* actor.start`. An Effect actor is
> done with the Effect's success as an `Option` output, which `toEffect(actor)` gives you; a Stream
> actor holds each element in `snapshot.context`. A stop, or the close of the scope, interrupts the
> work and runs its finalizers.

## When you need this

You have an Effect or a Stream, and you want it to behave as an actor: a snapshot that others can
read, a lifetime tied to a scope, an output, and done or error events for a parent machine.

To call asynchronous work from a state of a machine, see
[How to invoke asynchronous work](invoke-async.md), which uses the same logic.

## Steps

1. Wrap the Effect in `fromEffect`. The creator receives `{ input, system, self, emit }`;
   annotate the fields that you read.
2. Create the actor with `createActor`, and give the `input`. `createActor` returns an Effect
   that needs a `Scope`.
3. Start the actor with `yield* actor.start`. `start` returns while the Effect runs in the actor's
   own fiber.
4. Wait for the output with `toEffect(actor)`. It succeeds with the `output` of the actor's last
   snapshot, an `Option`, and fails with the actor's error when the Effect fails.
5. Run the program with `Effect.scoped`, so that the actor stops when the program ends.

```ts
import { createActor, fromEffect, toEffect } from "@jambudipa/xstate-effect"
import { Console, Effect, Option } from "effect"

const checksum = fromEffect(({ input }: { input: { text: string } }) =>
  Effect.gen(function* () {
    yield* Effect.sleep("100 millis")
    return [...input.text].reduce((sum, char) => (sum + char.charCodeAt(0)) % 65536, 0)
  })
)

const program = Effect.gen(function* () {
  const actor = yield* createActor(checksum, { input: { text: "hello" } })
  yield* actor.start

  const output = yield* toEffect(actor)
  yield* Console.log(Option.getOrElse(output, () => -1)) // 532

  const snapshot = yield* actor.getSnapshot
  yield* Console.log(snapshot.status) // done
})

void Effect.runPromise(Effect.scoped(program))
```

When the Effect fails, the actor's status is `error`, `snapshot.error` holds the failure as an
`Option`, and `toEffect(actor)` fails with the raw failure value.

## Variations

### Run a Stream

Wrap the Stream in `fromStream`. Each element becomes the actor's `snapshot.context`, as
`Option.some(element)`; the context is `Option.none()` before the first element. The end of the
Stream gives status `done`, with an `output` of `Option.none()`. A failure of the Stream gives
status `error`.

Follow the elements with `actor.subscribe`, which receives each snapshot published after the
call, or with the `actor.changes` Stream, which starts with the current snapshot.

```ts
import { createActor, fromStream, toEffect } from "@jambudipa/xstate-effect"
import { Console, Effect, Option, Stream } from "effect"

const countdown = fromStream(({ input }: { input: { from: number } }) =>
  Stream.range(1, input.from).pipe(
    Stream.map((step) => input.from - step),
    Stream.tap(() => Effect.sleep("10 millis"))
  )
)

const program = Effect.gen(function* () {
  const actor = yield* createActor(countdown, { input: { from: 3 } })
  yield* actor.subscribe((snapshot) =>
    Option.match(snapshot.context, {
      onNone: () => Effect.void,
      onSome: (remaining) => Console.log(`remaining: ${remaining}`)
    })
  )
  yield* actor.start

  // Waits for the end of the Stream: remaining: 2, remaining: 1, remaining: 0
  yield* toEffect(actor)
})

void Effect.runPromise(Effect.scoped(program))
```

### Stop the work early

`yield* actor.stop` interrupts the Effect or the Stream, so its finalizers run, and gives status
`stopped`. A stopped actor sends no done event to a parent. Closing the scope that created the
actor stops it in the same way.

```ts
import { createActor, fromEffect } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const watcher = fromEffect(() =>
  Effect.never.pipe(Effect.ensuring(Console.log("watcher released")))
)

const program = Effect.gen(function* () {
  const actor = yield* createActor(watcher)
  yield* actor.start
  yield* actor.stop // watcher released

  const snapshot = yield* actor.getSnapshot
  yield* Console.log(snapshot.status) // stopped
})

void Effect.runPromise(Effect.scoped(program))
```

### Give the Effect its services

The services that the Effect requires become requirements of the logic, and `createActor` asks
for them. Provide them to the program that creates the actor, with `Effect.provideService` or a
`Layer`. A Stream's services work the same way.

```ts
import { createActor, fromEffect, toEffect } from "@jambudipa/xstate-effect"
import { Console, Context, Effect, Option } from "effect"

class ExchangeRates extends Context.Service<ExchangeRates, {
  readonly rate: (from: string, to: string) => Effect.Effect<number>
}>()("ExchangeRates") {}

const convert = fromEffect(({ input }: { input: { amount: number; from: string; to: string } }) =>
  Effect.gen(function* () {
    const rates = yield* ExchangeRates
    const rate = yield* rates.rate(input.from, input.to)
    return input.amount * rate
  })
)

const program = Effect.gen(function* () {
  // The type of this Effect requires ExchangeRates
  const actor = yield* createActor(convert, { input: { amount: 100, from: "GBP", to: "EUR" } })
  yield* actor.start

  const converted = yield* toEffect(actor)
  yield* Console.log(Option.getOrElse(converted, () => 0)) // 117
})

void Effect.runPromise(
  program.pipe(
    Effect.provideService(ExchangeRates, { rate: () => Effect.succeed(1.17) }),
    Effect.scoped
  )
)
```

For a machine whose actors need services, see
[How to give a machine's actions and actors Effect services](provide-services-to-a-machine.md).

### Report progress while the Effect runs

Call `emit` from the Effect: it returns an Effect that delivers the event to the actor's listeners
at once. Listen with `actor.on(type, handler)`, or read the `actor.emissions` Stream. The type of
`emit`'s argument gives the type of the events that the actor emits.

```ts
import { createActor, fromEffect, toEffect } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

interface Progress {
  readonly type: "progress"
  readonly done: number
  readonly total: number
}

const importRows = fromEffect(
  ({ input, emit }: { input: { rows: ReadonlyArray<string> }; emit: (event: Progress) => Effect.Effect<void> }) =>
    Effect.gen(function* () {
      for (const [index] of input.rows.entries()) {
        yield* Effect.sleep("10 millis")
        yield* emit({ type: "progress", done: index + 1, total: input.rows.length })
      }
      return input.rows.length
    })
)

const program = Effect.gen(function* () {
  const actor = yield* createActor(importRows, { input: { rows: ["a", "b", "c"] } })
  yield* actor.on("progress", (event) => Console.log(`${event.done}/${event.total}`))
  yield* actor.start
  yield* toEffect(actor) // after 1/3, 2/3 and 3/3
})

void Effect.runPromise(Effect.scoped(program))
```

### Keep the actor active after the Effect returns

Use `fromEffectBackground` for work that must never complete the actor, such as a poller. The
actor stays `active` when the Effect returns, and only a stop, the end of its scope or a failure
ends it. A parent receives no done event from it.

```ts
import { createActor, fromEffectBackground } from "@jambudipa/xstate-effect"
import { Console, Effect, Schedule } from "effect"

const heartbeat = fromEffectBackground(({ input }: { input: { url: string } }) =>
  Effect.tryPromise(() => fetch(input.url, { method: "HEAD" })).pipe(
    Effect.andThen((response) => Console.log(`heartbeat: ${response.status}`)),
    Effect.repeat(Schedule.spaced("30 seconds"))
  )
)

export const program = Effect.gen(function* () {
  const actor = yield* createActor(heartbeat, { input: { url: "https://example.com/health" } })
  yield* actor.start
  // The heartbeat runs until this scope closes
  yield* Effect.sleep("2 minutes")
})
```

### Run it as a child of a machine

Register the logic under `actors` in `setup` and invoke it, as for any other actor. For a Stream,
add `onSnapshot`: the parent then receives each active snapshot of the child, and reads the latest
element from `event.snapshot.context`. The end of the Stream takes `onDone`.

```ts
import { assign, fromStream, setup } from "@jambudipa/xstate-effect"
import { Option, Schedule, Stream } from "effect"

const uploadProgress = fromStream(({ input }: { input: { chunks: number } }) =>
  Stream.range(1, input.chunks).pipe(Stream.schedule(Schedule.spaced("50 millis")))
)

export const uploadMachine = setup({
  types: {} as {
    context: { chunks: number; uploaded: number }
    events: { type: "UPLOAD" }
  },
  actors: { uploadProgress }
}).createMachine({
  id: "upload",
  initial: "idle",
  context: { chunks: 4, uploaded: 0 },
  states: {
    idle: {
      on: { UPLOAD: "uploading" }
    },
    uploading: {
      invoke: {
        src: "uploadProgress",
        input: ({ context }) => ({ chunks: context.chunks }),
        onSnapshot: {
          actions: assign({
            uploaded: ({ event, context }) => Option.getOrElse(event.snapshot.context, () => context.uploaded)
          })
        },
        onDone: "complete",
        onError: "idle"
      }
    },
    complete: {}
  }
})
```

To retry a failing Effect, see [How to retry a failing service](retry-pattern.md).

## Related

- [fromEffect, fromEffectBackground and fromEffectRetry](../reference/actors/from-effect.md):
  the Effect logics, their snapshot and their creator's arguments.
- [fromStream](../reference/actors/from-stream.md): the Stream logic and its snapshot.
- [createActor and the actor](../reference/create-actor.md): `start`, `stop`, `subscribe`,
  `changes`, `on` and `emissions`.
- [waitFor, toEffect and toPromise](../reference/testing/wait-for.md): waiting for a snapshot or
  an output.
- [Actor lifetimes and scopes](../explanation/actor-lifetimes-and-scopes.md): why a scope owns
  each actor.
