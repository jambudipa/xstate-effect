/**
 * The guard of the default run against pending upstream rewrites (HARNESS-2, SD-1: a rewrite
 * that `test/upstream/pending.json` lists stays out of the default run until its CONF task
 * imports it and removes it from the list).
 *
 * A test worker loads a module in one of two ways, and the guard covers both. It reads the
 * modules the run loads, not the source text, so the form of the import does not matter.
 * - Through Vitest's module runner: each `import` and `import()` of a test or of a module it
 *   loads, whatever its specifier (a literal, a variable, a parameter, a `new URL(...)`), and
 *   `vi.importActual`. The runner fetches the module from the Vite server of the run, which
 *   records it in its module graph and transforms it through the plugins. The guard's plugin
 *   (`plugin`) fails the transform of each pending path, so the module never runs and the import
 *   fails with the path in its message.
 * - Through Node's own loader: `createRequire(import.meta.url)(path)`, and each import of a
 *   module that Node loads that way. The guard's setup file (`pending-rewrite-setup.ts`)
 *   registers a Node load hook in each test worker that fails the load of each pending path,
 *   and records the path in the test module's meta.
 * At the end of the run, the reporter (`PendingRewriteGuard`) collects each pending path in the
 * module graph of each Vite environment of each project, each path the plugin blocked, and each
 * path the setup file recorded. When there is any, it names each one and sets the process exit
 * code to 1, so `vitest run` fails, also when a test catches the failed import.
 *
 * Each part compares paths in the form the disk stores them (`canonicalPath`): the real path
 * that the operating system gives, with each link resolved and each name in the letter case on
 * the disk. On a disk that ignores letter case (macOS APFS by default), `./upstream/Select.test.js`
 * loads `select.test.ts`, and Vite and Node keep the case that the import typed; the guard maps
 * that path to `select.test.ts` before it looks it up, so the import is blocked and named.
 *
 * Outside the guard: a `Worker` thread or a child process that a test starts itself. Neither
 * runs through the test worker's module runner or its Node load hook.
 *
 * `vitest.config.ts` wires the three parts in. `vitest.upstream.config.ts` leaves them out, so a
 * named pending rewrite runs there.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Plugin } from "vite"
import type { Reporter, TestModule, Vitest } from "vitest/node"

/** The list of pending rewrites, relative to the root of the run. */
export const PENDING_LIST = "test/upstream/pending.json"

/** The first line of the guard's report. HARNESS-2 finds the report by it. */
export const PENDING_GUARD_HEADER = `[pending-rewrite guard] The default run loads no rewrite that ${PENDING_LIST} lists:`

/** The name of the guard's Vite plugin. */
export const PENDING_GUARD_PLUGIN = "harness-2:pending-rewrite-guard"

/** The key of a test module's meta under which the setup file records each pending path that Node's loader was asked to load. */
export const PENDING_LOADS_META = "harness2PendingRewriteLoads"

/** The message of the error that fails the load of a pending rewrite. */
export const blockedMessage = (entry: string): string =>
  `[pending-rewrite guard] ${entry} is listed in ${PENDING_LIST}, so the default run must not load it`

/**
 * The path of a file in the form the disk stores it: the operating system's real path
 * (`realpathSync.native`), with each link resolved and each name in the letter case on the
 * disk; the path itself when no such file exists. `realpathSync` without `.native` keeps the
 * letter case of its argument, so the guard does not use it.
 */
export const canonicalPath = (path: string): string => (existsSync(path) ? realpathSync.native(path) : path)

/**
 * The pending rewrites of a root: the canonical path (`canonicalPath`) of each entry of its
 * pending list, mapped to the entry. Empty when the root has no pending list. Look a path up
 * with `pendingEntryOf`, which makes it canonical first.
 */
export const pendingPathsOf = (root: string): ReadonlyMap<string, string> => {
  const list = resolve(root, PENDING_LIST)
  if (!existsSync(list)) return new Map()
  const entries = JSON.parse(readFileSync(list, "utf8")) as ReadonlyArray<string>
  return new Map(entries.map((entry) => [canonicalPath(resolve(root, entry)), entry] as const))
}

/** The pending entry of a file, by its canonical path, else undefined. */
export const pendingEntryOf = (pending: ReadonlyMap<string, string>, file: string): string | undefined =>
  pending.get(canonicalPath(file))

/**
 * The pending entry of a file, for a loader that does not know the root of the run: the entry
 * that the pending list of a folder above the file lists for it, else undefined. The file and
 * its folders are taken in canonical form (`canonicalPath`). Each folder's list is read once.
 */
export const pendingEntryFinder = (): ((file: string) => string | undefined) => {
  const lists = new Map<string, ReadonlyMap<string, string>>()
  const listAt = (folder: string): ReadonlyMap<string, string> => {
    const known = lists.get(folder)
    if (known !== undefined) return known
    const found = pendingPathsOf(folder)
    lists.set(folder, found)
    return found
  }
  return (file) => {
    const canonical = canonicalPath(file)
    for (let folder = dirname(canonical); ; folder = dirname(folder)) {
      const entry = listAt(folder).get(canonical)
      if (entry !== undefined || dirname(folder) === folder) return entry
    }
  }
}

/** The file of a module id, without its query; null for a virtual module. */
const fileOf = (id: string): string | null => (id.startsWith("\0") ? null : id.split("?")[0] ?? null)

/** The pending paths that the setup file recorded in a test module's meta. */
const recordedLoads = (testModule: TestModule): ReadonlyArray<string> => {
  const recorded = (testModule.meta() as Readonly<Record<string, unknown>>)[PENDING_LOADS_META]
  return Array.isArray(recorded) ? recorded.filter((entry): entry is string => typeof entry === "string") : []
}

/** The guard: a reporter, with the Vite plugin that blocks each pending path in `plugin`. */
export class PendingRewriteGuard implements Reporter {
  /** The entry of each pending rewrite whose load the plugin failed. */
  private readonly blocked = new Set<string>()
  private vitest: Vitest | undefined = undefined

  /** The guard's Vite plugin: it fails the transform of each pending path, before any other plugin. */
  readonly plugin: Plugin = ((): Plugin => {
    let pending: ReadonlyMap<string, string> = new Map()
    return {
      name: PENDING_GUARD_PLUGIN,
      enforce: "pre",
      configResolved: (config) => {
        pending = pendingPathsOf(config.root)
      },
      transform: (_code, id) => {
        const file = fileOf(id)
        const entry = file === null ? undefined : pendingEntryOf(pending, file)
        if (entry === undefined) return null
        this.blocked.add(entry)
        throw new Error(blockedMessage(entry))
      }
    }
  })()

  onInit(vitest: Vitest): void {
    this.vitest = vitest
    this.blocked.clear()
  }

  /**
   * The entry of each pending rewrite that the run loaded, sorted: each pending path in the
   * module graph of a Vite environment of a project (a module the run fetched, or one that a
   * module it loaded imports by name), each path the plugin blocked, and each path the setup
   * file recorded for a test module.
   */
  loaded(vitest: Vitest, testModules: ReadonlyArray<TestModule>): ReadonlyArray<string> {
    const pending = pendingPathsOf(vitest.config.root)
    const servers = new Set([vitest.vite, ...vitest.projects.map((project) => project.vite)])
    const inGraph = [...servers]
      .flatMap((server) => Object.values(server.environments))
      .flatMap((environment) => [...environment.moduleGraph.idToModuleMap.values()])
      .flatMap((node) => {
        const file = node.file ?? fileOf(node.id ?? "")
        const entry = file === null ? undefined : pendingEntryOf(pending, file)
        return entry === undefined ? [] : [entry]
      })
    return [...new Set([...this.blocked, ...inGraph, ...testModules.flatMap(recordedLoads)])].sort()
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const vitest = this.vitest
    if (vitest === undefined) return
    const found = this.loaded(vitest, testModules)
    if (found.length === 0) return
    process.exitCode = 1
    vitest.logger.error([PENDING_GUARD_HEADER, ...found.map((entry) => `  ${entry}`)].join("\n"))
  }
}
