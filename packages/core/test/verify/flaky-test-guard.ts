/**
 * The flakyTest guard of the default run (CONF-8, AC 28: no test uses `flakyTest`).
 *
 * `flakyTest` of `@effect/vitest` retries an Effect inside an ordinary test until it succeeds,
 * so a test that fails at first passes and its options show nothing; the no-skip guard cannot see
 * it. A source scan reads every name a test may write, but a key assembled at run time
 * (`Reflect.get(it, "flaky" + "Test")`) reaches it past any scan. This module closes that class
 * at run time: the default run gives it in place of `@effect/vitest`, whatever route loads the
 * package.
 *
 * - Through Vite: `vitest.config.ts` aliases the exact specifier `@effect/vitest` (also with a
 *   query or hash suffix) to this file.
 * - Through Node's own loader: the guard's setup file (`flaky-test-setup.ts`), which every Vitest
 *   config of the package lists, registers a resolve hook that gives this file for the specifier
 *   `@effect/vitest`, and for every other specifier that names the package's entry module or its
 *   internal modules (a path into `node_modules`, a `file:` URL), but for this file's own ES
 *   import of the entry module and the package's own relative imports (a require never passes,
 *   whatever base a test gives it).
 *
 * It re-exports the real package, which it imports by the path of its entry module (an alias of
 * the package name would give this file back), and replaces each value that reaches `flakyTest`:
 * - `flakyTest` is a function that throws an error naming AC 28;
 * - `it` is a Proxy of the real `it` whose `get` and `getOwnPropertyDescriptor` throw that error
 *   for the key `flakyTest` (any spelling that reaches the key, a key assembled at run time too),
 *   and pass every other key and every call through unchanged; its `layer` passes the body of a
 *   layer block the same guard over the methods it gives (`it.layer(L)("x", (it) => ...)`);
 * - `layer`, `makeMethods` and `describeWrapped` give their methods behind the same guard.
 * Each blocked access is also recorded in the meta of the test module that runs
 * (`FLAKY_TEST_META`), and the no-skip guard's reporter names it and fails the run at its end,
 * also when a test catches the error.
 *
 * Node loads this file without a bundler when a test reaches the package through Node's own
 * loader, so it imports nothing but the real package and `vitest`, and uses only syntax that
 * Node's type stripping erases.
 */
import * as real from "../../node_modules/@effect/vitest/dist/index.js"
import { TestRunner } from "vitest"

export * from "../../node_modules/@effect/vitest/dist/index.js"

/** The key of a test module's meta under which the guard records each blocked access (`no-skip-reporter.ts` reads it). */
export const FLAKY_TEST_META = "conf8FlakyTestAccesses"

/** The key that the guard blocks. */
const BLOCKED_KEY = "flakyTest"

/** The message of the error that each blocked access throws. */
export const flakyTestBlockedMessage = (route: string): string =>
  `[flakyTest guard] ${route}: AC 28 allows no test to use flakyTest of @effect/vitest (it retries an Effect until it succeeds, so a failing test passes); the default run blocks every route to it`

/** Records a blocked access in the meta of the test module that runs now, once, sorted. */
const record = (route: string): void => {
  const file = TestRunner.getCurrentTest()?.file ?? TestRunner.getCurrentSuite()?.file
  if (file === undefined) return
  const known = (file.meta as Readonly<Record<string, unknown>>)[FLAKY_TEST_META]
  const routes = Array.isArray(known) ? known.filter((entry): entry is string => typeof entry === "string") : []
  Object.assign(file.meta, { [FLAKY_TEST_META]: [...new Set([...routes, route])].sort() })
}

/** Records a blocked access, then throws its error. */
const block = (route: string): never => {
  record(route)
  throw new Error(flakyTestBlockedMessage(route))
}

/** A function whose last arguments may be the body of a layer block: each function argument gets its methods behind the guard. */
type Register = (...args: ReadonlyArray<unknown>) => unknown

/**
 * A layer of the API (`it.layer`, `layer`, the `layer` of a layer block's methods): the same
 * layer, whose block body receives its methods behind the guard (`guardMethods`).
 */
const guardLayer = (layer: unknown, route: string): unknown => {
  if (typeof layer !== "function") return layer
  const make = layer as (...args: ReadonlyArray<unknown>) => Register
  return (...layerArgs: ReadonlyArray<unknown>): Register => {
    const register = make(...layerArgs)
    return (...args) =>
      register(...args.map((arg) =>
        typeof arg === "function" ? (methods: object) => (arg as (methods: object) => unknown)(guardMethods(methods, `${route}(...) methods`)) : arg
      ))
  }
}

/**
 * The test API (`it`, or the methods of a layer block): a Proxy whose `get` and
 * `getOwnPropertyDescriptor` block the key `flakyTest`, give `layer` behind the guard, and pass
 * every other key, and every call, to the real value unchanged.
 */
const guardMethods = <A extends object>(methods: A, route: string): A =>
  new Proxy(methods, {
    get: (target, key, receiver) => {
      if (key === BLOCKED_KEY) return block(`${route}.${BLOCKED_KEY}`)
      const value: unknown = Reflect.get(target, key, receiver)
      return key === "layer" ? guardLayer(value, `${route}.layer`) : value
    },
    getOwnPropertyDescriptor: (target, key) => {
      if (key === BLOCKED_KEY) return block(`${route}.${BLOCKED_KEY}`)
      return Reflect.getOwnPropertyDescriptor(target, key)
    }
  })

/** The guard in place of `flakyTest`: it throws. */
const blockedFlakyTest = (..._args: ReadonlyArray<unknown>): never => block(BLOCKED_KEY)

export { blockedFlakyTest as "flakyTest" }

/** `it` of the real package behind the guard. */
export const it: typeof real.it = guardMethods(real.it, "it")

/** `layer` of the real package: its block body receives its methods behind the guard. */
export const layer = guardLayer(real.layer, "layer") as typeof real.layer

/** `makeMethods` of the real package: the methods it makes, behind the guard. */
export const makeMethods: typeof real.makeMethods = (api) => guardMethods(real.makeMethods(api), "makeMethods(...)")

/** `describeWrapped` of the real package: its body receives the test API behind the guard. */
export const describeWrapped: typeof real.describeWrapped = (name, body) =>
  real.describeWrapped(name, (api) => body(guardMethods(api, "describeWrapped(...) it")))
