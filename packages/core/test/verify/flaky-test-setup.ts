/**
 * The setup file of the flakyTest guard (CONF-8, AC 28: no test uses `flakyTest`), which every
 * Vitest config of the package lists (`vitest.config.ts`, `vitest.upstream.config.ts`): it covers
 * the loads that bypass Vite, through Node's own loader, and the members of `process` that load
 * or spawn code. The configs' alias gives the guard (`flaky-test-guard.ts`) to the loads through
 * Vite.
 *
 * The first time in a test worker it registers a Node resolve hook for that worker's thread
 * (`module.registerHooks`):
 * - it gives the guard's module for the specifier `@effect/vitest` (also with a query or hash
 *   suffix), and for each other specifier whose resolution names the package's entry module or
 *   one of its internal modules (a path into `node_modules`, a `file:` URL). It passes on only two
 *   imports of the real package: the guard's own import of the entry module by its exact
 *   specifier, and a relative import from one module of the package's `dist/` to another, each an
 *   ES module `import`. A require never passes, whatever base it has: `createRequire` lets a test
 *   choose the base of a require, so a require from the guard's module or from the package's own
 *   folder is a test's require (the eighth Layer-3 review's G14, G22, G23);
 * - it refuses a builtin that loads or spawns code (`POWERFUL_BUILTINS`: `node:child_process`,
 *   `node:worker_threads`, `node:vm`, `node:module`, ...) to each importer outside the dependency
 *   store. Vite loads a builtin for each module it runs from its own module evaluator, which lies
 *   in the store, and the source scan of CONF-8 allows such an import only in a pinned harness
 *   module; Node's own loader names the real importer, a module of the repository or a file a
 *   test wrote, and no such module may load one.
 * It also puts a guard on each member of `process` that loads or spawns code: `getBuiltinModule`
 * of a powerful builtin (`node:module` only to Vite's module runner, which takes `Module` from
 * it, by V8's call sites), `binding` of the bindings that spawn, compile or run code,
 * `_linkedBinding`, `dlopen` of an addon outside the dependency store, and `execve`.
 *
 * Each refusal throws, and is recorded in the meta of the test module the worker runs
 * (`FLAKY_TEST_META`), so the no-skip guard's reporter names it and fails the run, also when a
 * test catches the error. Node loads nothing of this file but through Vite.
 */
import { realpathSync } from "node:fs"
import { isBuiltin, registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { type RunnerTestFile, TestRunner } from "vitest"
import { FLAKY_TEST_META } from "./no-skip-reporter.js"

/** What the guard of a worker reads: the test module the worker runs now. */
interface GuardState {
  file: RunnerTestFile | undefined
}

/** The key of the worker's global under which the guard keeps its state. */
const STATE = Symbol.for("conf-8.flaky-test-guard")

const guardGlobal = globalThis as typeof globalThis & { [STATE]?: GuardState }

/** The exact specifier by which the guard's module imports the real package (`FLAKY_TEST_GUARD_ENTRY` of `skip-scan.ts`). */
const GUARD_ENTRY = "../../node_modules/@effect/vitest/dist/index.js"

/** The builtins that load or spawn code, without `node:`. */
const POWERFUL_BUILTINS: ReadonlySet<string> = new Set([
  "child_process", "cluster", "inspector", "inspector/promises", "module", "repl", "vm", "wasi", "worker_threads"
])

/** The bindings of `process.binding` that spawn a process, compile or run code, or start a worker. */
const POWERFUL_BINDINGS: ReadonlySet<string> = new Set(["spawn_sync", "process_wrap", "contextify", "worker", "inspector", "module_wrap"])

/** The message of the error that each refusal throws. */
const refusedMessage = (route: string): string =>
  `[flaky-test guard] ${route}: AC 28 allows no test to reach the retrying helper of @effect/vitest, so the run refuses each route that loads or spawns code past the source scan`

/** The guard's state of this worker, and the guard registered once in the worker. */
const guardState = (): GuardState => {
  const known = guardGlobal[STATE]
  if (known !== undefined) return known
  const state: GuardState = { file: undefined }
  guardGlobal[STATE] = state
  const refuse = (route: string): never => {
    const file = state.file
    if (file !== undefined) {
      const known = (file.meta as Readonly<Record<string, unknown>>)[FLAKY_TEST_META]
      const routes = Array.isArray(known) ? known.filter((entry): entry is string => typeof entry === "string") : []
      Object.assign(file.meta, { [FLAKY_TEST_META]: [...new Set([...routes, route])].sort() })
    }
    throw new Error(refusedMessage(route))
  }
  const guard = new URL("./flaky-test-guard.ts", import.meta.url).href
  const packageUrl = pathToFileURL(`${realpathSync(fileURLToPath(new URL("../../node_modules/@effect/vitest", import.meta.url)))}/`).href
  const storeUrl = pathToFileURL(`${realpathSync(fileURLToPath(new URL("../../node_modules/.pnpm", import.meta.url)))}/`).href
  const fileOf = (url: string): string => url.split(/[?#]/)[0] ?? url
  const guarded = (url: string): boolean => fileOf(url) === `${packageUrl}dist/index.js` || fileOf(url).startsWith(`${packageUrl}dist/internal/`)
  /** The two imports of the real package that pass: the guard's import of the entry module, and the package's own relative imports, each an ES module import. */
  const passes = (specifier: string, parent: string | undefined, conditions: ReadonlyArray<string>): boolean =>
    parent !== undefined && conditions.includes("import") && !conditions.includes("require") &&
    (fileOf(parent) === guard ? specifier === GUARD_ENTRY : fileOf(parent).startsWith(`${packageUrl}dist/`) && /^\.\.?\//.test(specifier))
  const pathOf = (url: string | undefined): string => (url === undefined ? "no importer" : url.startsWith("file:") ? fileURLToPath(fileOf(url)) : url)
  const powerful = (id: string): boolean => isBuiltin(id) && POWERFUL_BUILTINS.has(id.replace(/^node:/, ""))
  const tempUrl = pathToFileURL(`${realpathSync(fileURLToPath(new URL("../../node_modules", import.meta.url)))}/.vite-temp/`).href
  /**
   * Vite's bundle of a Vitest config of the package, which a nested run loads by Node's own loader
   * and which takes `node:module` for its require shim (`<config>.timestamp-<n>-<hex>.mjs`).
   */
  const configBundle = (parent: string | undefined): boolean =>
    parent !== undefined && parent.startsWith(tempUrl) &&
    /^vitest(?:\.upstream)?\.config\.ts\.timestamp-\d+-[0-9a-f]+\.mjs$/.test(fileOf(parent).slice(tempUrl.length))
  registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const parent = context.parentURL
      const allowed = (parent ?? "").startsWith(storeUrl) || (configBundle(parent) && specifier.replace(/^node:/, "") === "module")
      if (powerful(specifier) && !allowed) return refuse(`${specifier} from ${pathOf(parent)}`)
      if (passes(specifier, parent, context.conditions)) return nextResolve(specifier, context)
      if (/^@effect\/vitest(?:[?#]|$)/.test(specifier)) return { url: guard, shortCircuit: true }
      const resolved = nextResolve(specifier, context)
      return guarded(resolved.url) ? { url: guard, shortCircuit: true } : resolved
    }
  })
  const getBuiltinModule = process.getBuiltinModule.bind(process)
  const binding = (process as unknown as { binding: (name: string) => unknown }).binding.bind(process)
  const dlopen = process.dlopen.bind(process)
  const NativeError = Error
  /**
   * The file of the code that calls a guarded member of `process`, read from V8's own call sites
   * (a frame of native code has none); null when the call sites cannot be read (a test that
   * replaced `Error.prepareStackTrace` or fixed it), so the guard refuses.
   */
  const callerOf = (member: (id: string) => unknown): string | null => {
    const prepare = NativeError.prepareStackTrace
    const limit = NativeError.stackTraceLimit
    const own = (_error: Error, sites: Array<NodeJS.CallSite>): Array<NodeJS.CallSite> => sites
    try {
      NativeError.prepareStackTrace = own
      NativeError.stackTraceLimit = 1
      if (NativeError.prepareStackTrace !== own) return null
      const holder: { stack?: unknown } = {}
      NativeError.captureStackTrace(holder, member)
      const [site]: ReadonlyArray<unknown> = Array.isArray(holder.stack) ? holder.stack : []
      const file: unknown = typeof site === "object" && site !== null ? (site as NodeJS.CallSite).getFileName() : null
      return typeof file === "string" ? file : null
    } catch {
      return null
    } finally {
      NativeError.prepareStackTrace = prepare
      NativeError.stackTraceLimit = limit
    }
  }
  /** Vite's module runner, which takes `Module` of `node:module` (`process.getBuiltinModule("node:module")`). */
  const viteRunner = (file: string | null): boolean =>
    file !== null && file.startsWith(storeUrl) && file.endsWith("/node_modules/vite/dist/node/module-runner.js")
  /**
   * `getBuiltinModule` behind the guard: a powerful builtin is refused, and `node:module` is given
   * to Vite's module runner alone (its `createRequire` takes any base, the dependency store's too).
   */
  const guardedGetBuiltinModule = (id: string): unknown => {
    if (!powerful(id)) return getBuiltinModule(id)
    const caller = callerOf(guardedGetBuiltinModule)
    return id.replace(/^node:/, "") === "module" && viteRunner(caller)
      ? getBuiltinModule(id)
      : refuse(`process.getBuiltinModule(${JSON.stringify(id)}) from ${caller ?? "native code"}`)
  }
  Object.assign(process, {
    getBuiltinModule: guardedGetBuiltinModule,
    binding: (name: string): unknown => (POWERFUL_BINDINGS.has(name) ? refuse(`process.binding(${JSON.stringify(name)})`) : binding(name)),
    _linkedBinding: (name: string): never => refuse(`process._linkedBinding(${JSON.stringify(name)})`),
    dlopen: (module: { exports: unknown }, filename: string, flags?: number): void =>
      pathToFileURL(realpathSync(filename)).href.startsWith(storeUrl) ? dlopen(module, filename, flags) : refuse(`process.dlopen(${JSON.stringify(filename)})`),
    execve: (file: string): never => refuse(`process.execve(${JSON.stringify(file)})`)
  })
  return state
}

guardState().file = TestRunner.getCurrentSuite().file
