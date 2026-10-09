/**
 * The setup file of the default run's pending-rewrite guard (HARNESS-2): it covers the loads
 * that bypass Vite (see `pending-rewrite-guard.ts`).
 *
 * `vitest.config.ts` lists this file in `setupFiles`, so it runs in each test worker before the
 * worker collects each test module. The first time in a worker, it registers a Node load hook
 * for that worker's thread (`module.registerHooks`). The hook fails Node's load of each file
 * that the pending list of a folder above it lists, both taken in the form the disk stores them
 * (`canonicalPath`: a wrong letter case or a link names the file it loads), so the module never
 * runs, and records the entry in the meta of the test module the worker runs (the setup file
 * points the hook at it each time). The guard's reporter reads the meta at the end of the run:
 * it names each entry and fails the run, also when a test catches the failed load.
 *
 * The loads through Node's own loader of the flakyTest guard (CONF-8, AC 28) are the work of the
 * setup file that every Vitest config of the package lists beside this one,
 * `flaky-test-setup.ts`.
 */
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import { type RunnerTestFile, TestRunner } from "vitest"
import { blockedMessage, PENDING_LOADS_META, pendingEntryFinder } from "./pending-rewrite-guard.js"

/** What the hook of a worker reads: the test module the worker runs now. */
interface HookState {
  file: RunnerTestFile | undefined
}

/** The key of the worker's global under which the hook keeps its state. */
const STATE = Symbol.for("harness-2.pending-rewrite-guard")

const workerGlobal = globalThis as typeof globalThis & { [STATE]?: HookState }

/** Records a blocked entry in the meta of a test module, once, sorted. */
const record = (file: RunnerTestFile, entry: string): void => {
  const known = (file.meta as Readonly<Record<string, unknown>>)[PENDING_LOADS_META]
  const entries = Array.isArray(known) ? known.filter((value): value is string => typeof value === "string") : []
  Object.assign(file.meta, { [PENDING_LOADS_META]: [...new Set([...entries, entry])].sort() })
}

/** The state of this worker's hook; the first call registers the hook. */
const hookState = (): HookState => {
  const known = workerGlobal[STATE]
  if (known !== undefined) return known
  const state: HookState = { file: undefined }
  workerGlobal[STATE] = state
  const entryOf = pendingEntryFinder()
  registerHooks({
    load: (url, context, nextLoad) => {
      const entry = url.startsWith("file:") ? entryOf(fileURLToPath(url)) : undefined
      if (entry === undefined) return nextLoad(url, context)
      if (state.file !== undefined) record(state.file, entry)
      throw new Error(blockedMessage(entry))
    }
  })
  return state
}

hookState().file = TestRunner.getCurrentSuite().file
