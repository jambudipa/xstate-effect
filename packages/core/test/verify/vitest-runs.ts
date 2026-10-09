/**
 * Runs of Vitest on fixture files, through a config file of the package (HARNESS-2, CONF-8).
 *
 * A check of a guard of the default run (`no-skip-reporter.ts`, `pending-rewrite-guard.ts`,
 * `flaky-test-guard.ts`) writes its fixture files into a temporary package root (`fixtureRoot`)
 * and runs Vitest on them in this process, with Vitest's node API and worker threads
 * (`runWithConfig`): no test spawns a child Vitest process (SD-1).
 *
 * This module holds Vitest's node API (`vitest/node`) for the package's tests: CONF-8 allows it
 * only here and in two evidence files, each pinned by its whole source (`CAPABILITY_HOLDERS` of
 * `skip-scan.ts`), and only CONF-8 and HARNESS-2 may import this module. A run goes through a
 * Vitest config of the package alone, `vitest.config.ts` or `vitest.upstream.config.ts`, each of
 * which gives the flakyTest guard (CONF-8, AC 28), and changes nothing of the config but its
 * reporters: so no nested run reaches flakyTest of `@effect/vitest`. The one run without the
 * guards (`runUnguarded`) is the liveness control of CONF-8's flakyTest routes, and CONF-8 alone
 * may take it.
 */
import { Effect } from "effect"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import { createVitest, startVitest } from "vitest/node"
import { FLAKY_TEST_GUARD_HEADER, NO_SKIP_GUARD_HEADER } from "./no-skip-reporter.js"
import { PENDING_GUARD_HEADER } from "./pending-rewrite-guard.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))

const sorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...values].sort()

/** The Vitest config files of the package, each of which gives the flakyTest guard. */
export const PACKAGE_CONFIGS = ["vitest.config.ts", "vitest.upstream.config.ts"] as const

/** A Vitest config file of the package. */
export type PackageConfig = (typeof PACKAGE_CONFIGS)[number]

/**
 * The config file, checked at run time: one of `PACKAGE_CONFIGS`, whatever the caller's types
 * say. Any other value fails the run, so no run of this module goes through another config.
 */
const packageConfig = (configFile: string): Effect.Effect<string> =>
  (PACKAGE_CONFIGS as ReadonlyArray<string>).includes(configFile)
    ? Effect.succeed(join(pkgRoot, configFile))
    : Effect.die(new Error(`vitest-runs runs the Vitest configs of the package only (${PACKAGE_CONFIGS.join(", ")}): ${String(configFile)}`))

/**
 * The reporters of an override, checked at run time: an array of reporter names, or none. Any
 * other key of the override fails the run, so a run changes nothing of its config but its
 * reporters (a setup file, an alias or a plugin stays).
 */
const reportersOf = (overrides: { readonly reporters?: Array<string> }): Effect.Effect<{ readonly reporters?: Array<string> }> => {
  const keys = Object.keys(overrides)
  const reporters: unknown = overrides.reporters
  return keys.every((key) => key === "reporters") &&
      (reporters === undefined || (Array.isArray(reporters) && reporters.every((entry) => typeof entry === "string")))
    ? Effect.succeed(reporters === undefined ? {} : { reporters: [...(reporters as Array<string>)] })
    : Effect.die(new Error(`vitest-runs overrides the reporters of a run only: ${JSON.stringify(keys)}`))
}

/**
 * A temporary package root for the fixtures of a guard: each file at its path, and
 * `node_modules/` linking the three packages the fixtures import. The folder is removed when
 * the test's scope closes.
 */
export const fixtureRoot = (files: ReadonlyArray<readonly [string, string]>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), "harness-2-guard-"))
      mkdirSync(join(root, "node_modules", "@effect"), { recursive: true })
      for (const dependency of ["vitest", "@effect/vitest", "effect"]) {
        symlinkSync(join(pkgRoot, "node_modules", dependency), join(root, "node_modules", dependency), "dir")
      }
      for (const [path, source] of files) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), source)
      }
      return root
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true }))
  )

/** What one run of Vitest through a config file of the package shows. */
export interface GuardRun {
  /** The exit code the run set for the process: `vitest run` exits with it. */
  readonly exitCode: string | number | null | undefined
  /** The module of each test file the run collected, sorted. */
  readonly modules: ReadonlyArray<string>
  /** Vitest's own verdict: no test failed, and no error escaped a test. */
  readonly ok: boolean
  /** The module of each test file that Vitest itself passes (it loaded, and no test of it failed), sorted. */
  readonly passed: ReadonlyArray<string>
  /** The lines of the no-skip guard's report, without the header; none when it reported nothing. */
  readonly report: ReadonlyArray<string>
  /** The lines of the pending-rewrite guard's report, without the header; none when it reported nothing. */
  readonly pendingReport: ReadonlyArray<string>
  /** The lines of the flakyTest guard's report (blocked accesses, `<module>: <route>`), without the header; none when it reported nothing. */
  readonly flakyTestReport: ReadonlyArray<string>
  /** Each test the run reported, as `<module> > <full name>`. */
  readonly tests: ReadonlyArray<string>
}

/** The lines of a guard's report in a run's output, found by its header, without the header. */
const guardReport = (output: string, headerLine: string = NO_SKIP_GUARD_HEADER): ReadonlyArray<string> => {
  const lines = output.split("\n")
  const header = lines.indexOf(headerLine)
  if (header === -1) return []
  const rest = lines.slice(header + 1)
  const end = rest.findIndex((entry) => !entry.startsWith("  "))
  return (end === -1 ? rest : rest.slice(0, end)).map((entry) => entry.trim())
}

/**
 * One run of Vitest (`startVitest`, as `vitest run` runs) on files of `root` with the options
 * given, in worker threads and with one worker. The process exit code is cleared before the run
 * and restored after it, so a guard's exit code is read from this run alone and never reaches the
 * run of the calling file.
 */
const run = (files: ReadonlyArray<string>, options: { readonly config: string | false; readonly root: string; readonly reporters?: Array<string> }) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = process.exitCode
      process.exitCode = undefined
      return saved
    }),
    () =>
      Effect.promise(async (): Promise<GuardRun> => {
        const output: Array<string> = []
        const sink = new Writable({
          write(chunk: unknown, _encoding, done) {
            output.push(String(chunk))
            done()
          }
        })
        const vitest = await startVitest(
          [...files],
          { run: true, watch: false, pool: "threads", maxWorkers: 1, ...options },
          {},
          { stdout: sink, stderr: sink }
        )
        const testModules = vitest.state.getTestModules()
        return {
          exitCode: process.exitCode,
          modules: sorted(testModules.map((testModule) => testModule.relativeModuleId)),
          ok: testModules.every((testModule) => testModule.ok()) && vitest.state.getUnhandledErrors().length === 0,
          passed: sorted(testModules.filter((testModule) => testModule.ok()).map((testModule) => testModule.relativeModuleId)),
          report: guardReport(output.join("")),
          pendingReport: guardReport(output.join(""), PENDING_GUARD_HEADER),
          flakyTestReport: guardReport(output.join(""), FLAKY_TEST_GUARD_HEADER),
          tests: testModules.flatMap((testModule) =>
            [...testModule.children.allTests()].map((test) => `${testModule.relativeModuleId} > ${test.fullName}`)
          )
        }
      }),
    (saved) =>
      Effect.sync(() => {
        process.exitCode = saved
      })
  )

/**
 * Runs Vitest on files of `root` as `vitest run` does, with a config file of this package
 * (`vitest.config.ts` for the default run: its include globs, its plugins, setup files, aliases
 * and reporters and so the guards; `vitest.upstream.config.ts`) and the temporary root. Two
 * options differ from the default run, and neither touches the guards: worker threads instead of
 * child processes (SD-1), and one worker. `overrides` replaces the config's reporters, as a CLI
 * flag does, and nothing else. A config file or an override key of another kind fails the run.
 */
export const runWithConfig = (
  configFile: PackageConfig,
  root: string,
  files: ReadonlyArray<string>,
  overrides: { readonly reporters?: Array<string> } = {}
) =>
  Effect.flatMap(
    Effect.all([packageConfig(configFile), reportersOf(overrides)]),
    ([config, reporters]) => run(files, { config, root, ...reporters })
  )

/**
 * Runs Vitest on files of `root` without any config file (`config: false`): no alias, no setup
 * file, no guard, and the default reporter alone. It is the liveness control of CONF-8's
 * flakyTest routes (each route reaches flakyTest without the guard), and CONF-8 alone may take
 * it (`CAPABILITY_HOLDERS` of `skip-scan.ts`).
 */
export const runUnguarded = (root: string, files: ReadonlyArray<string>) =>
  run(files, { config: false, root, reporters: ["default"] })

/**
 * The files that the default config's include collects in a package root, as `vitest run`
 * collects them: Vitest's own glob of the include and exclude globs (it reads dot folders and dot
 * files, and follows links), through Vitest's node API in this process (SD-1). Paths relative to
 * the root, sorted. No test runs.
 */
export const collectedFiles = (root: string) =>
  Effect.acquireUseRelease(
    Effect.promise(() => createVitest("test", { config: join(pkgRoot, "vitest.config.ts"), root, watch: false })),
    (vitest) =>
      Effect.promise(async () =>
        (await vitest.globTestSpecifications())
          .map((specification) => relative(vitest.config.root, specification.moduleId).split(sep).join("/"))
          .sort()
      ),
    (vitest) => Effect.promise(() => vitest.close())
  )

/** The resolve aliases of a config as Vite resolved them: each target, and whether it has a resolver of its own. */
export interface ResolvedAliases {
  readonly replacements: ReadonlyArray<string>
  readonly customResolvers: number
  readonly tsconfigPaths: unknown
}

/**
 * The resolve aliases of a Vitest config of the package as Vitest resolves them (a plugin may add
 * one), at the package root. No test runs.
 */
export const resolvedAliases = (configFile: PackageConfig) =>
  Effect.flatMap(packageConfig(configFile), (config) =>
    Effect.acquireUseRelease(
      Effect.promise(() => createVitest("test", { config, root: pkgRoot, watch: false })),
      (vitest) =>
        Effect.sync((): ResolvedAliases => {
          const resolved = vitest.vite.config.resolve
          return {
            replacements: resolved.alias.map((entry) => entry.replacement),
            customResolvers: resolved.alias.filter((entry) => entry.customResolver !== undefined && entry.customResolver !== null).length,
            tsconfigPaths: (resolved as { readonly tsconfigPaths?: unknown }).tsconfigPaths
          }
        }),
      (vitest) => Effect.promise(() => vitest.close())
    ))
