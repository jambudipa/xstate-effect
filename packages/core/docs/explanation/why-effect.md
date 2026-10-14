# Why Effect?

@jambudipa/xstate-effect is built on [Effect-TS](https://effect.website), a powerful TypeScript library for building type-safe, composable applications. This document explains why Effect is the foundation of this library and what benefits it provides.

## What is Effect?

Effect is a comprehensive library that provides:

- **Typed errors** - Errors are part of the type signature
- **Dependency injection** - Services are provided through the type system
- **Resource management** - Automatic cleanup of resources
- **Concurrency primitives** - Fibers, queues, and more
- **Structured programming** - Composable, declarative code

## Benefits for State Machines

### 1. Type-Safe Error Handling

In traditional state machines, errors are often untyped or handled inconsistently. With Effect, errors are explicitly typed:

```typescript
import { Effect, Data } from "effect"
import { fromEffect } from "@jambudipa/xstate-effect"

// Define typed errors
class NetworkError extends Data.TaggedError("NetworkError")<{
  message: string
  statusCode: number
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
  reason: string
}> {}

interface User {
  id: string
  email?: string
}

// Actor knows exactly what errors it can produce
export const fetchUserActor = fromEffect(({ input }: { input: { id: string } }) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`/api/users/${input.id}`),
      catch: (error) => new NetworkError({
        message: String(error),
        statusCode: 0
      })
    })

    if (!response.ok) {
      return yield* Effect.fail(new NetworkError({
        message: "Request failed",
        statusCode: response.status
      }))
    }

    const data: User = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (error) => new NetworkError({
        message: String(error),
        statusCode: response.status
      })
    })
    if (!data.email) {
      return yield* Effect.fail(new ValidationError({
        field: "email",
        reason: "Missing required field"
      }))
    }

    return data
  })
)
```

### 2. Composable Actions

An action in @jambudipa/xstate-effect can return an Effect. The actor runs that Effect as part of
the transition, so actions compose like any other Effect:

```typescript
import { Effect, Console, Context, pipe } from "effect"
import { setup } from "@jambudipa/xstate-effect"

class Database extends Context.Service<Database, {
  readonly save: (data: string) => Effect.Effect<void>
}>()("Database") {}

export const documentSetup = setup({
  types: {} as { context: { count: number; url: string; data: string } },
  actions: {
    // Simple action
    log: ({ context }) => Console.log(`Count: ${context.count}`),

    // Composed action with retry
    fetchWithRetry: ({ context }) =>
      pipe(
        Effect.tryPromise(() => fetch(context.url)),
        Effect.retry({ times: 3 }),
        Effect.timeout("10 seconds"),
        Effect.catch((e) => Console.error(`Failed: ${e}`))
      ),

    // Action using services
    saveToDatabase: ({ context }) =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.save(context.data)
        yield* Console.log("Saved successfully")
      })
  }
})
```

An action's Effect must handle its own failures: a failure that escapes it stops the actor with
status `error`, as an exception in an XState action does.

### 3. Dependency Injection

Effect's service pattern allows clean dependency injection:

```typescript
import { Console, Effect, Context, Layer } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

// Define a service
class Logger extends Context.Service<Logger, {
  readonly log: (message: string) => Effect.Effect<void>
}>()("Logger") {}

// Use in actions
const machine = setup({
  types: {} as { context: { id: string } },
  actions: {
    myAction: ({ context }) =>
      Effect.gen(function* () {
        const logger = yield* Logger
        yield* logger.log(`Processing: ${context.id}`)
      })
  }
}).createMachine({
  context: { id: "order-42" },
  initial: "processing",
  states: {
    processing: { entry: "myAction" }
  }
})

// Provide implementation at runtime
export const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start
  // ...
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.succeed(Logger, {
    log: (msg) => Console.log(`[LOG] ${msg}`)
  }))
)
```

The actor runs its actions, and the actors it invokes, with the services of the program that
created it. For a machine made with `setup`, the type of `createActor` lists the services that
its actions and actors need, so the compiler reminds you to provide them, as it does for a
`fromEffect` actor that you create directly.

### 4. Resource Management

Effect automatically handles resource cleanup. When the actor stops, the Effect is interrupted
and the release still runs:

```typescript
import { Console, Effect } from "effect"
import { fromEffect } from "@jambudipa/xstate-effect"

// Your own database client
interface Connection {
  query: (sql: string) => Promise<number>
  close: () => Promise<void>
}
declare const database: { connect: () => Promise<Connection> }

export const orderCountActor = fromEffect(() =>
  Effect.scoped(
    Effect.gen(function* () {
      const conn = yield* Effect.acquireRelease(
        // Acquire
        Effect.gen(function* () {
          const conn = yield* Effect.tryPromise(() => database.connect())
          yield* Console.log("Connected")
          return conn
        }),
        // Release (always runs)
        (conn) =>
          Effect.promise(() => conn.close()).pipe(
            Effect.andThen(Console.log("Disconnected"))
          )
      )
      return yield* Effect.tryPromise(() => conn.query("SELECT count(*) FROM orders"))
    })
  )
)
```

### 5. Structured Concurrency

Effect provides powerful concurrency primitives:

```typescript
import { Effect, pipe } from "effect"
import { fromEffect } from "@jambudipa/xstate-effect"

const fetchJson = (url: string) =>
  Effect.tryPromise(() => fetch(url).then((r): Promise<unknown> => r.json()))

// Parallel execution
export const parallelFetch = fromEffect(({ input }: { input: { urls: string[] } }) =>
  Effect.all(
    input.urls.map(url => fetchJson(url)),
    { concurrency: 5 }  // Max 5 concurrent requests
  )
)

// Racing
export const raceToComplete = fromEffect(() =>
  Effect.race(
    fetchJson("https://primary.example.com/data"),
    fetchJson("https://backup.example.com/data")
  )
)

// Timeout
export const withTimeout = fromEffect(() =>
  pipe(
    fetchJson("/api/slow-report"),
    Effect.timeout("5 seconds")
  )
)
```

### 6. Testing Benefits

Effect makes testing deterministic and controllable:

```typescript
import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createActor, createMachine, waitFor } from "@jambudipa/xstate-effect"

const timerMachine = createMachine({
  initial: "running",
  states: {
    running: { after: { 5000: "completed" } },
    completed: { type: "final" }
  }
})

// Control time in tests: `it.effect` runs the test on the TestClock
it.effect("completes after five seconds", () =>
  Effect.gen(function* () {
    const actor = yield* createActor(timerMachine)
    yield* actor.start

    // Fast-forward time
    yield* TestClock.adjust("5 seconds")

    const snapshot = yield* waitFor(actor, (snapshot) => snapshot.status === "done")
    assert.strictEqual(snapshot.value, "completed")
  })
)
```

## Effect vs Promises

### Promises

```typescript
// Eager execution - runs immediately
const promise = fetch("/api/data")

// Error handling is optional
void promise.then(data => console.log(data))
// If you forget .catch(), errors are swallowed

// No cancellation
// Can't stop a running promise
```

### Effect

```typescript
import { Effect, Fiber } from "effect"

// Lazy - just a description, doesn't run yet
const effect = Effect.tryPromise(() => fetch("/api/data"))

// Type system tracks errors
// Effect.Effect<Response, Cause.UnknownError, never>
//                         ^^ Error is part of the type

// Cancellable via fibers
export const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(effect)
  yield* Fiber.interrupt(fiber)
})
```

## Effect vs Callbacks

### Callbacks

```typescript
interface Data { items: string[] }
interface Result { saved: number }
type Callback<T> = (err: Error | null, value?: T) => void

// Your own callback-style functions
declare function processData(data: Data, callback: Callback<Result>): void
declare function saveResult(result: Result, callback: Callback<void>): void
declare function handleError(err: Error | null): void
declare function done(): void

function fetchData(callback: Callback<Data>) {
  fetch("/api/data")
    .then(r => r.json())
    .then(data => callback(null, data))
    .catch(err => callback(err))
}

// Callback hell
fetchData((err, data) => {
  if (err || !data) return handleError(err)
  processData(data, (err, result) => {
    if (err || !result) return handleError(err)
    saveResult(result, (err) => {
      if (err) return handleError(err)
      done()
    })
  })
})
```

### Effect

```typescript
import { Effect } from "effect"

interface Data { items: string[] }
interface Result { saved: number }

// The same steps as Effects
declare const fetchData: () => Effect.Effect<Data, Error>
declare const processData: (data: Data) => Effect.Effect<Result, Error>
declare const saveResult: (result: Result) => Effect.Effect<void, Error>

export const program = Effect.gen(function* () {
  const data = yield* fetchData()
  const result = yield* processData(data)
  yield* saveResult(result)
})

// Flat, readable, type-safe
```

## Integration with State Machines

Effect enhances state machines in several ways:

### Actions as Effects

```typescript
import { Console, Effect, pipe } from "effect"
import { assign, setup } from "@jambudipa/xstate-effect"

// Your own Promise-based API
declare function riskyOperation(): Promise<void>

export const progressSetup = setup({
  types: {} as { context: { count: number } },
  actions: {
    // Simple sync action
    increment: assign({ count: ({ context }) => context.count + 1 }),

    // Async action with Effect
    saveProgress: ({ context }) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise(() =>
          fetch("/api/save", {
            method: "POST",
            body: JSON.stringify(context)
          })
        )
      }),

    // Action with error handling
    riskyAction: () =>
      pipe(
        Effect.tryPromise(() => riskyOperation()),
        Effect.catch((error) =>
          Console.error(`Failed: ${error}`)
        )
      )
  }
})
```

### Guards as Effects

```typescript
import { Clock, Effect } from "effect"
import { setup } from "@jambudipa/xstate-effect"

export const checkoutSetup = setup({
  types: {} as { context: { isValid: boolean; deadline: number } },
  guards: {
    // Sync guard
    canProceed: ({ context }) => context.isValid,

    // Effect guard (returns Effect<boolean>)
    beforeDeadline: ({ context }) =>
      Effect.map(Clock.currentTimeMillis, (now) => now < context.deadline)
  }
})
```

A guard's Effect has the type `Effect<boolean>`: it cannot fail and needs no service. Here it
reads the Effect clock, so a test can move the time with `TestClock`.

### Actors as Effects

```typescript
import { Context, Effect, Option, type Duration } from "effect"
import { fromEffect, fromPromise, setup } from "@jambudipa/xstate-effect"

type Rows = ReadonlyArray<unknown>

class Database extends Context.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<Rows>
}>()("Database") {}

class Cache extends Context.Service<Cache, {
  readonly get: (key: string) => Effect.Effect<Option.Option<Rows>>
  readonly set: (key: string, rows: Rows, options: { ttl: Duration.Input }) => Effect.Effect<void>
}>()("Cache") {}

export const dataSetup = setup({
  actors: {
    // Promise-based
    fetchUser: fromPromise(async ({ input }: { input: { id: string } }): Promise<unknown> => {
      const response = await fetch(`/api/users/${input.id}`)
      return response.json()
    }),

    // Effect-based with full power
    processData: fromEffect(({ input }: { input: { key: string; query: string } }) =>
      Effect.gen(function* () {
        const db = yield* Database
        const cache = yield* Cache

        // Check cache first
        const cached = yield* cache.get(input.key)
        if (Option.isSome(cached)) return cached.value

        // Fetch from database
        const data = yield* db.query(input.query)

        // Cache result
        yield* cache.set(input.key, data, { ttl: "5 minutes" })

        return data
      })
    )
  }
})
```

A machine that invokes `processData` needs `Database` and `Cache`: provide them around the
program that creates the machine's actor, as in the dependency injection example above.

## Summary

Effect provides @jambudipa/xstate-effect with:

| Feature | Benefit |
|---------|---------|
| Typed errors | Know exactly what can fail |
| Composition | Build complex from simple |
| Services | Clean dependency injection |
| Resources | Automatic cleanup |
| Concurrency | Structured parallel execution |
| Testing | Deterministic, controllable tests |
| Laziness | Describe before executing |
| Cancellation | Stop running operations |

The combination of state machines (explicit state modeling) and Effect (explicit effect modeling) creates a powerful, type-safe foundation for building reliable applications.

## Further Reading

- [Effect Documentation](https://effect.website/docs)
- [The Actor Model](./actor-model.md)
