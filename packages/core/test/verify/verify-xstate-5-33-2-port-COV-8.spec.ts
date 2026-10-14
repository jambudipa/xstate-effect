/**
 * COV-8: the dev entry point finds the global object in upstream's order.
 *
 * Coverage layer #8 (`src/dev`, risk R-017, P3). Upstream `getGlobal` (`src/dev/index.ts` at
 * xstate@5.33.2) gives `globalThis`, else `self`, else `window`, else `global`. The port reads
 * the four candidates each time `getGlobal` runs and gives the first that exists as an
 * `Option`.
 *
 * Node has `globalThis` and `global` and no `self`, so the default run never meets a `self`
 * candidate or a missing `global`, which is how a browser's global object looks. Both are
 * plain properties of the global object, so the test adds `self` and `window` and removes
 * `global` around one synchronous `getGlobal` run, and puts each back at once.
 *
 * A missing `globalThis` is out of reach: Effect 4.0.0 reads `globalThis` in every fiber run
 * loop and when `Effect.fn` opens the span of `getGlobal`, before the body runs, so no runtime
 * without `globalThis` can run `getGlobal`. The P14 spec covers upstream's warning for no
 * global object through the lookup behind `getGlobal`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import { getGlobal } from "../../src/dev/index.js"

/** What one global property was before the test changed it: its own descriptor, if any. */
interface Saved {
  readonly key: string
  readonly descriptor: PropertyDescriptor | undefined
}

/**
 * Runs `getGlobal` once with the global object changed: each key of `remove` deleted, each
 * entry of `add` set. Every change is undone right after the run, whatever its outcome.
 */
const getGlobalWith = (remove: ReadonlyArray<string>, add: Readonly<Record<string, unknown>>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved: ReadonlyArray<Saved> = [...remove, ...Object.keys(add)].map((key) => ({
        key,
        descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
      }))
      for (const key of remove) {
        Reflect.deleteProperty(globalThis, key)
      }
      for (const [key, value] of Object.entries(add)) {
        Reflect.set(globalThis, key, value)
      }
      return saved
    }),
    () => getGlobal(),
    (saved) =>
      Effect.sync(() => {
        for (const { key, descriptor } of saved) {
          if (descriptor) {
            Reflect.defineProperty(globalThis, key, descriptor)
          } else {
            Reflect.deleteProperty(globalThis, key)
          }
        }
      })
  )

/** Runs `program` with a logger that keeps the message of each warning. */
const withWarnings = <A, E, R>(warned: Array<unknown>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            warned.push(...(Array.isArray(options.message) ? options.message : [options.message]))
          }
        }),
      ])
    )
  )

/** The global properties the test changes, as the Node process has them. */
const nodeGlobals = () => ({
  global: Object.getOwnPropertyDescriptor(globalThis, "global"),
  self: Object.hasOwn(globalThis, "self"),
  window: Object.hasOwn(globalThis, "window"),
})

describe("COV-8 the dev entry point finds the global object in upstream's order", () => {
  it.effect("[COV-8] in a browser-like global object (self and window, no global), getGlobal gives globalThis, the first candidate", () =>
    Effect.gen(function* () {
      const before = nodeGlobals()
      const warned: Array<unknown> = []
      const self: unknown = { marker: "self" }
      const window: unknown = { marker: "window" }

      const found = yield* withWarnings(warned, getGlobalWith(["global"], { self, window }))

      // globalThis wins over self and window, as upstream's order says; nothing is warned
      assert.isTrue(Option.isSome(found))
      assert.strictEqual(Option.getOrThrow(found), globalThis)
      assert.deepStrictEqual(warned, [])
      // The global object is as it was
      assert.deepStrictEqual(nodeGlobals(), before)
      assert.strictEqual(global, globalThis)
    }))
})
