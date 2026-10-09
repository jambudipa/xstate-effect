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

// Define typed errors
class NetworkError extends Data.TaggedError("NetworkError")<{
  message: string
  statusCode: number
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
  reason: string
}> {}

// Actor knows exactly what errors it can produce
const _fetchUserActor = fromEffect(({ input }: { input: { id: string } }) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`/api/users/${input.id}`),
      catch: (error) => new NetworkError({
        message: String(error),
        statusCode: 0
      })
    })

    if (!response.ok) {
      yield* Effect.fail(new NetworkError({
        message: "Request failed",
        statusCode: response.status
      }))
    }

    const data = yield* Effect.tryPromise(() => response.json())
    if (!data.email) {
      yield* Effect.fail(new ValidationError({
        field: "email",
        reason: "Missing required field"
      }))
    }

    return data
  })
)
```

### 2. Composable Actions

Actions in @jambudipa/xstate-effect are Effects, making them composable:

```typescript
import { Effect, Console, pipe } from "effect"

// Simple action
const _logAction = action("log", ({ context }) =>
  Console.log(`Count: ${context.count}`)
)

// Composed action with retry
const _fetchWithRetry = action("fetchWithRetry", ({ context }) =>
  pipe(
    Effect.tryPromise(() => fetch(context.url)),
    Effect.retry({ times: 3 }),
    Effect.timeout("10 seconds"),
    Effect.tapError((e) => Console.error(`Failed: ${e}`))
  )
)

// Action using services
const _saveToDatabase = action("save", ({ context }) =>
  Effect.gen(function* () {
    const db = yield* DatabaseService
    yield* db.save(context.data)
    yield* Console.log("Saved successfully")
  })
)
```

### 3. Dependency Injection

Effect's service pattern allows clean dependency injection:

```typescript
import { Effect, Context, Layer } from "effect"

// Define a service
class Logger extends Context.Tag("Logger")<
  Logger,
  { log: (message: string) => Effect.Effect<void> }
>() {}

// Use in actions
const _myAction = action("myAction", ({ context }) =>
  Effect.gen(function* () {
    const logger = yield* Logger
    yield* logger.log(`Processing: ${context.id}`)
  })
)

// Provide implementation at runtime
const _program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start()
  // ...
}).pipe(
  Effect.provide(Layer.succeed(Logger, {
    log: (msg) => Console.log(`[LOG] ${msg}`)
  }))
)
```

### 4. Resource Management

Effect automatically handles resource cleanup:

```typescript
const _connectionActor = fromEffect(() =>
  Effect.acquireRelease(
    // Acquire
    Effect.gen(function* () {
      const conn = yield* Effect.tryPromise(() => database.connect())
      yield* Console.log("Connected")
      return conn
    }),
    // Release (always runs)
    (conn) => Effect.gen(function* () {
      yield* Effect.tryPromise(() => conn.close())
      yield* Console.log("Disconnected")
    })
  )
)
```

### 5. Structured Concurrency

Effect provides powerful concurrency primitives:

```typescript
// Parallel execution
const _parallelFetch = fromEffect(({ input }: { input: { urls: string[] } }) =>
  Effect.all(
    input.urls.map(url =>
      Effect.tryPromise(() => fetch(url).then(r => r.json()))
    ),
    { concurrency: 5 }  // Max 5 concurrent requests
  )
)

// Racing
const _raceToComplete = fromEffect(() =>
  Effect.race(
    Effect.tryPromise(() => fetchFromPrimary()),
    Effect.tryPromise(() => fetchFromBackup())
  )
)

// Timeout
const _withTimeout = fromEffect(() =>
  pipe(
    Effect.tryPromise(() => slowOperation()),
    Effect.timeout("5 seconds")
  )
)
```

### 6. Testing Benefits

Effect makes testing deterministic and controllable:

```typescript
import { TestClock, TestContext } from "effect"

// Control time in tests
const _testProgram = Effect.gen(function* () {
  const actor = yield* createActor(timerMachine)
  yield* actor.start()

  // Fast-forward time
  yield* TestClock.adjust("5 seconds")

  const snapshot = yield* actor.getSnapshot()
  expect(snapshot.value).toBe("completed")
}).pipe(
  Effect.provide(TestContext.TestContext)
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
// Lazy - just a description, doesn't run yet
const effect = Effect.tryPromise(() => fetch("/api/data"))

// Type system tracks errors
// Effect.Effect<Response, Error, never>
// ^^ Error is part of the type

// Cancellable via fibers
const fiber = yield* Effect.fork(effect)
yield* Fiber.interrupt(fiber)
```

## Effect vs Callbacks

### Callbacks

```typescript
function fetchData(callback: (err: Error | null, data?: Data) => void) {
  fetch("/api/data")
    .then(r => r.json())
    .then(data => callback(null, data))
    .catch(err => callback(err))
}

// Callback hell
fetchData((err, data) => {
  if (err) return handleError(err)
  processData(data, (err, result) => {
    if (err) return handleError(err)
    saveResult(result, (err) => {
      if (err) return handleError(err)
      done()
    })
  })
})
```

### Effect

```typescript
const _program = Effect.gen(function* () {
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
actions: {
  // Simple sync action
  increment: assign({ count: ({ context }) => context.count + 1 }),

  // Async action with Effect
  saveProgress: action("saveProgress", ({ context }) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        fetch("/api/save", {
          method: "POST",
          body: JSON.stringify(context)
        })
      )
    })
  ),

  // Action with error handling
  riskyAction: action("riskyAction", () =>
    pipe(
      Effect.tryPromise(() => riskyOperation()),
      Effect.catchAll((error) =>
        Console.error(`Failed: ${error}`)
      )
    )
  )
}
```

### Guards as Effects

```typescript
guards: {
  // Sync guard
  canProceed: guard("canProceed", ({ context }) =>
    context.isValid
  ),

  // Async guard (returns Effect<boolean>)
  hasPermission: guard("hasPermission", ({ context }) =>
    Effect.gen(function* () {
      const permissions = yield* PermissionService
      return yield* permissions.check(context.userId, "admin")
    })
  )
}
```

### Actors as Effects

```typescript
actors: {
  // Promise-based
  fetchUser: fromPromise(async ({ input }) => {
    const response = await fetch(`/api/users/${input.id}`)
    return response.json()
  }),

  // Effect-based with full power
  processData: fromEffect(({ input }) =>
    Effect.gen(function* () {
      const db = yield* DatabaseService
      const cache = yield* CacheService

      // Check cache first
      const cached = yield* cache.get(input.key)
      if (cached) return cached

      // Fetch from database
      const data = yield* db.query(input.query)

      // Cache result
      yield* cache.set(input.key, data, { ttl: "5 minutes" })

      return data
    })
  )
}
```

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
- [Effect Integration Patterns](./effect-patterns.md)
- [The Actor Model](./actor-model.md)
