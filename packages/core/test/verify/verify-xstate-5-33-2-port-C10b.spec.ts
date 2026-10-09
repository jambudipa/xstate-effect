/**
 * C10b: an effect actor's requirements flow to createActor.
 *
 * T2.52. The Effect of `fromEffect`, `fromEffectBackground` and `fromEffectRetry` may need
 * services. They become the `R` of the actor logic, and `createActor(logic)` returns
 * `Effect<Actor, never, Scope | R>` (SD-8): the actor captures the caller's services when it is
 * created and gives them to the Effect it runs at `start`, in the actor's own fiber (D12). For
 * `fromEffectRetry`, the services the schedule needs join `R` too. Code that creates the actor
 * without providing a service does not type-check; the `@ts-expect-error` lines below prove it
 * under `pnpm typecheck` (`tsconfig.test.green.json`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Option, Schedule } from "effect"
import type { Scope } from "effect"
import type { ActorLogic } from "../../src/ActorLogic.js"
import { createActor, fromEffect, fromEffectBackground } from "../../src/index.js"
import { fromEffectRetry } from "../../src/actors/fromEffect.js"

/** A service the effect logic reads. */
class Greeter extends Context.Service<Greeter, { readonly greet: (name: string) => string }>()("c10b/Greeter") {}

/** A second service, read by a retry schedule. */
class RetryDelay extends Context.Service<RetryDelay, { readonly millis: number }>()("c10b/RetryDelay") {}

/** Yields until `condition` holds, at most 200 turns; gives whether it holds. */
const eventually = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (yield* condition) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* condition
  })

/** The effect logic of these cases: greets its input with the Greeter service. */
const greeting = fromEffect(({ input }: { readonly input: string }) =>
  Effect.map(Greeter, (greeter) => greeter.greet(input))
)

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

describe("C10b An effect actor's requirements flow to createActor", () => {
  it.effect("[C10b] an effect logic that reads a service gets it from the Effect that calls createActor, at start, in the actor's own fiber", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(greeting, { input: "Ada" }).pipe(
        Effect.provideService(Greeter, { greet: (name) => `Hello, ${name}` })
      )
      // `start` runs outside the provideService: the actor kept the services of its creation
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "done")), "the actor is done")

      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some("Hello, Ada"))
    })
  )

  it.effect("[C10b] the logic's R is the effect's requirements, and createActor requires Scope and R", () =>
    Effect.sync(() => {
      typeHolds<Equals<ActorLogic.RequirementsOf<typeof greeting>, Greeter>>(true)
      const create = createActor(greeting, { input: "Ada" })
      typeHolds<Equals<Effect.Services<typeof create>, Scope.Scope | Greeter>>(true)

      const background = fromEffectBackground(({ input }: { readonly input: string }) =>
        Effect.map(Greeter, (greeter) => greeter.greet(input))
      )
      typeHolds<Equals<ActorLogic.RequirementsOf<typeof background>, Greeter>>(true)

      // The schedule's services join the effect's (v4 `Schedule<Output, Input, Error, Env>`)
      const retried = fromEffectRetry(
        ({ input }: { readonly input: string }) => Effect.map(Greeter, (greeter) => greeter.greet(input)),
        Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.map(RetryDelay, (delay) => delay.millis)))
      )
      typeHolds<Equals<ActorLogic.RequirementsOf<typeof retried>, Greeter | RetryDelay>>(true)
      assert.isDefined(retried)
    })
  )

  it.effect("[C10b] code that creates an effect actor without providing its service fails the type-check", () =>
    Effect.sync(() => {
      // @ts-expect-error the Greeter service is not provided
      const withoutService: Effect.Effect<unknown, never, Scope.Scope> = createActor(greeting, { input: "Ada" })

      const provided: Effect.Effect<unknown, never, Scope.Scope> = createActor(greeting, { input: "Ada" }).pipe(
        Effect.provideService(Greeter, { greet: (name) => name })
      )

      const retried = fromEffectRetry(
        () => Effect.succeed(1),
        Schedule.recurs(1).pipe(Schedule.addDelay(() => Effect.map(RetryDelay, (delay) => delay.millis)))
      )
      // @ts-expect-error the RetryDelay service the schedule reads is not provided
      const retryWithoutService: Effect.Effect<unknown, never, Scope.Scope> = createActor(retried)

      assert.isDefined(withoutService)
      assert.isDefined(provided)
      assert.isDefined(retryWithoutService)
    })
  )

  it.effect("[C10b] a retry schedule that reads a service gets it from the Effect that calls createActor", () =>
    Effect.gen(function* () {
      let attempts = 0
      const logic = fromEffectRetry(
        ({ input }: { readonly input: string }) =>
          Effect.flatMap(Greeter, (greeter) =>
            Effect.suspend(() => {
              attempts++
              return attempts < 2 ? Effect.fail("not yet" as const) : Effect.succeed(greeter.greet(input))
            })
          ),
        Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.map(RetryDelay, (delay) => delay.millis)))
      )
      const actor = yield* createActor(logic, { input: "Grace" }).pipe(
        Effect.provideService(Greeter, { greet: (name) => `Hi, ${name}` }),
        Effect.provideService(RetryDelay, { millis: 0 })
      )
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "done")), "the actor is done")

      assert.strictEqual(attempts, 2)
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some("Hi, Grace"))
    })
  )
})
