/**
 * The witness of the BASELINE-1 smoke run (AC 3).
 *
 * BASELINE-1 runs `test/smoke.test.ts` through the default config with Vitest's node API in
 * its own process and adds this file to the setup files of that run only; the default run
 * never loads it. The file replaces the port's `createActor` in the module graph of the run
 * (`vi.mock` of `src/index.ts`: the original module, with `createActor` wrapped), so each
 * actor it makes records what the test does with it: the logic the actor is made from, each
 * event that `send` delivers, and each snapshot the test reads through `getSnapshot` or
 * `changes`. After each test the record goes into the meta of the test, which the run hands
 * back to BASELINE-1. A test that returns before it drives the counter machine, or never
 * runs, leaves no such record.
 */
import type { Effect, Stream } from "effect"
import { afterEach, beforeEach, vi } from "vitest"
import { counterMachine } from "../../examples/counter.js"

/** The key of the record in the meta of each test (BASELINE-1 reads it). */
const SMOKE_WITNESS_META = "baseline-1.smoke-witness"

/** What the actors of one test recorded, as the actors gave it. */
const witness = vi.hoisted(() => ({
  logics: [] as Array<unknown>,
  sent: [] as Array<unknown>,
  getSnapshot: [] as Array<unknown>,
  changes: [] as Array<unknown>
}))

vi.mock("../../src/index.js", async (importOriginal) => {
  const port = await importOriginal<typeof import("../../src/index.js")>()
  const { Effect, Stream } = await import("effect")
  const createActor = port.createActor as unknown as (logic: unknown, options?: unknown) => Effect.Effect<object, never, never>

  // The actor as the port made it, but `send`, `getSnapshot` and `changes` record what passes
  const watch = (actor: object): object =>
    new Proxy(actor, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key, target)
        if (key === "send") {
          const send = value as (event: unknown) => Effect.Effect<void>
          return (event: unknown) => Effect.tap(send(event), () => Effect.sync(() => witness.sent.push(event)))
        }
        if (key === "getSnapshot") {
          return Effect.tap(value as Effect.Effect<unknown>, (snapshot) => Effect.sync(() => witness.getSnapshot.push(snapshot)))
        }
        if (key === "changes") {
          return Stream.tap(value as Stream.Stream<unknown, unknown>, (snapshot) => Effect.sync(() => witness.changes.push(snapshot)))
        }
        return value
      }
    })

  return {
    ...port,
    createActor: (logic: unknown, options?: unknown) =>
      Effect.map(createActor(logic, options), (actor) => {
        witness.logics.push(logic)
        return watch(actor)
      })
  }
})

/** The status and the count of a snapshot the test read. */
const read = (snapshot: unknown) => {
  const { context, status } = snapshot as { readonly status?: unknown; readonly context?: { readonly count?: unknown } }
  return { status, count: context?.count }
}

beforeEach(() => {
  witness.logics.length = 0
  witness.sent.length = 0
  witness.getSnapshot.length = 0
  witness.changes.length = 0
})

afterEach(({ task }) => {
  Object.assign(task.meta, {
    [SMOKE_WITNESS_META]: {
      actors: witness.logics.map((logic) => (logic === counterMachine ? "counterMachine" : "another logic")),
      sent: [...witness.sent],
      getSnapshot: witness.getSnapshot.map(read),
      changes: witness.changes.map(read)
    }
  })
})
