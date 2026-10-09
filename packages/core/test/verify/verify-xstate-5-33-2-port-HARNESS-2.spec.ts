/**
 * HARNESS-2: upstream rewrites that are not green yet stay out of the default run.
 *
 * The checks read the resolved Vitest, TypeScript, ESLint and package configuration
 * in-process. No test spawns a child Vitest process (SD-1): the runs of the two guards below
 * use Vitest's node API in this process, with worker threads.
 *
 * "No pending rewrite is executed" holds at run time, for every import form by construction:
 * the default config runs the pending-rewrite guard (`pending-rewrite-guard.ts`). A test worker
 * loads a module either through Vitest's module runner, which fetches it from the Vite server of
 * the run, or through Node's own loader. The guard's plugin and its setup file's Node load hook
 * fail the load of each path that `pending.json` lists, so the module never runs; at the end of
 * the run the guard reads the server's module graph and the loads the hook blocked, names each
 * pending path the run loaded, and fails `vitest run`. Each part compares paths in the form the
 * disk stores them (`canonicalPath`: the operating system's real path, links resolved, each name
 * in the letter case on the disk), so on a disk that ignores letter case (macOS APFS by default)
 * `import "./upstream/Select.test.js"` is blocked and named as `select.test.ts`. This file proves
 * that the default config wires the guard in and that the upstream config leaves it out. It runs
 * Vitest through the default config on fixture files, one import form each, each form aimed at a
 * pending rewrite of its own (a literal static import, a literal dynamic import, a computed
 * `import(target)`, a parameter, a `new URL(...)` specifier, a re-exporting helper module, a
 * `createRequire` require, directly and through a re-exporting helper, a static import, a
 * `createRequire` require and a dynamic import that name the rewrite or its folder in another
 * letter case, and imports whose failure the test catches). One run takes the forms whose
 * failure Vitest sees, one run the forms whose failure the test catches (so the guard alone
 * fails it); each run fails, and the guard names the canonical pending path of each form. The
 * same forms load and run a rewrite that is not pending. On a disk that keeps letter case, a
 * path in another case names no file: that import fails, loads nothing, and the guard has
 * nothing to name. It runs the upstream config on a pending fixture by name, to prove that the
 * rewrite runs there. A green default run therefore executes no pending rewrite.
 *
 * Outside the guard, and so outside this proof: a `Worker` thread or a child process that a test
 * starts itself (`new Worker(...)`, `node:child_process`). Neither loads its modules through the
 * test worker's module runner or its Node load hook, so a pending rewrite that one of them loads
 * is neither blocked nor named.
 *
 * A default-run file runs an upstream rewrite by importing it (a CONF-n evidence file does
 * so once the rewrite is green, SD-1). An earlier check of the source text stays: the walk of
 * the imports of every collected file (`walkImports` of `skip-scan.ts`, which CONF-8 shares),
 * through each module they reach, in the package or outside its folder. No import may name a
 * path of `pending.json`, with both paths taken in the form the disk stores them, and the walk
 * reports each import whose specifier is not a string literal, each `import.meta.glob` and each
 * `#` specifier, since it cannot read the module that import names, and each reference to a
 * loader that is not a direct call with a literal specifier, since it cannot follow it. Its one
 * exemption is this file's own `importModule`, which loads the package's config files.
 *
 * "No test is skipped" holds at run time, for every form by construction: the default config
 * runs the no-skip guard (`no-skip-reporter.ts`) beside the default reporter, and the guard
 * fails `vitest run` and names each test or suite that ends skipped or todo, whatever form
 * skipped it. This file proves that the default config wires the guard in, and runs Vitest
 * through the default config on fixture files, one form each, to prove that each run fails and
 * names the case, and that a clean run passes. A green default run therefore skips no test.
 *
 * An earlier check of the source text stays: the syntax-tree scan of every module the import
 * walk reaches (a helper such as `conformance.ts` declares tests too). It finds the
 * `@effect/vitest` modifier forms (`it.effect.skip`, `it.effect.skipIf(cond)`, a test context's
 * `ctx.skip()`) that a flat text pattern misses, the Vitest options forms
 * (`describe("d", { skip: true }, body)`, `it.effect("x", body, { todo: true })`), options it
 * reads through a conditional, the module's variables and local functions, or the module that
 * exports an imported value (`upstreamFileOptions()` in `conformance.ts`), and the test API
 * under another name (`const t = it`). It reports each options value it cannot read. It has no
 * exemption: the SCXML rewrite filters its case list where upstream's `onlyTests` switch
 * focuses and skips cases. The scan (`skip-scan.ts`) also reads the fails and flakyTest forms
 * and the fails and retry options, which CONF-8 forbids in every test file (AC 28). A source
 * scan cannot read every form, so the no-skip guard is the closure.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { ESLint, Linter } from "eslint"
import { createHash } from "node:crypto"
import { existsSync, globSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join, matchesGlob } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import tseslint from "typescript-eslint"
import { confEvidenceSources, importsOf } from "./conformance.js"
import { NoSkipReporter } from "./no-skip-reporter.js"
import { isNonTestFile } from "./parity.js"
import { PENDING_GUARD_PLUGIN, PENDING_LIST, PendingRewriteGuard } from "./pending-rewrite-guard.js"
import { IMPORT_MODULE, type ModuleFacts, moduleFacts, readImportedOptions, walkImports } from "./skip-scan.js"
import { fixtureRoot, type GuardRun, runWithConfig } from "./vitest-runs.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))

const readText = (relative: string): string => readFileSync(join(pkgRoot, relative), "utf8")
const readJson = (relative: string): unknown => JSON.parse(readText(relative))

interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

interface VitestConfigModule {
  /** The absolute path of the pending-rewrite guard's setup file (the default config only). */
  readonly pendingRewriteSetup?: string
  readonly flakyTestSetup?: string
  readonly default: {
    readonly plugins?: ReadonlyArray<unknown>
    readonly test: {
      readonly include: ReadonlyArray<string>
      readonly exclude?: ReadonlyArray<string>
      readonly setupFiles?: ReadonlyArray<string>
      readonly testNamePattern?: unknown
      readonly reporters?: ReadonlyArray<unknown>
      readonly fsModuleCache?: boolean
    }
    readonly resolve?: {
      readonly alias?: unknown
    }
  }
}

interface TsConfig {
  readonly extends?: string
  readonly include?: ReadonlyArray<string>
  readonly files?: ReadonlyArray<string>
  readonly exclude: ReadonlyArray<string>
}

interface LegacyExclude {
  readonly path: string
  readonly owner: string
  readonly scenario: string
  readonly reason: string
}

interface EslintConfigModule {
  readonly default: ReadonlyArray<Linter.Config>
  readonly eslintConfigFor: (pending: ReadonlyArray<string>) => ReadonlyArray<Linter.Config>
}

const packageJson = (): PackageJson => readJson("package.json") as PackageJson
const pendingRewrites = (): ReadonlyArray<string> =>
  readJson("test/upstream/pending.json") as ReadonlyArray<string>

const importModule = <A>(relative: string) =>
  Effect.promise(() => import(pathToFileURL(join(pkgRoot, relative)).href) as Promise<A>)

const matchesAny = (path: string, globs: ReadonlyArray<string>): boolean =>
  globs.some((glob) => matchesGlob(path, glob))

const isCollected = (
  config: VitestConfigModule["default"]["test"],
  path: string
): boolean => matchesAny(path, config.include) && !matchesAny(path, config.exclude ?? [])

const collectedFiles = (config: VitestConfigModule["default"]["test"]): ReadonlyArray<string> =>
  globSync([...config.include], { cwd: pkgRoot })
    .filter((path) => !matchesAny(path, config.exclude ?? []))
    .sort()

const sorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...values].sort()

const eslintWith = (pending: ReadonlyArray<string>) =>
  Effect.map(
    importModule<EslintConfigModule>("eslint.config.mjs"),
    (module) =>
      new ESLint({
        cwd: pkgRoot,
        overrideConfigFile: true,
        overrideConfig: [...module.eslintConfigFor(pending)]
      })
  )

const PENDING_PROBE = "test/upstream/pending-probe.test.ts"

// ---------------------------------------------------------------- the syntax-tree skip scan

// The scan itself (`treeFacts`, `readImportedOptions`), the one parse of each module
// (`moduleFacts`) and the import walk (`walkImports`, with its one named exemption
// `IMPORT_MODULE`, this file's own `importModule`) live in `skip-scan.ts`, which CONF-8 shares.

/**
 * A member chain built from its parts. A fixture builds each plain `<root>.<modifier>` form
 * with it, so this file's own text never holds one for the text scan below to match.
 */
const member = (...names: ReadonlyArray<string>): string => names.join(".")

/** The code of a found form, without its `<file>:<line> ` prefix. */
const codeOf = (found: string): string => found.slice(found.indexOf(" ") + 1)

/** `source` with its one occurrence of `from` replaced by `to`; fails when `from` does not occur exactly once. */
const replaceOnce = (source: string, from: string, to: string): string => {
  assert.strictEqual(source.split(from).length - 1, 1, `the fixture anchor ${JSON.stringify(from)} must occur once`)
  return source.replace(from, () => to)
}

// ---------------------------------------------------------------- one read per module

/** Each package file this test file read, or undefined when no such file exists. */
const packageFiles = new Map<string, string | undefined>()

/**
 * The source of a package file, or undefined when no such file exists. Each path is read
 * from disk once: the tests below share the reads, and the files do not change during a run.
 */
const readPackageFile = (path: string): string | undefined => {
  if (!packageFiles.has(path)) {
    const absolute = join(pkgRoot, path)
    packageFiles.set(path, existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute, "utf8") : undefined)
  }
  return packageFiles.get(path)
}

/**
 * The imported options values of a module, each read in the module of the package that exports
 * it: nothing when it holds no skip option; else the argument, followed by the forms found in
 * the exporting module. The argument alone when the scan cannot read the value there (a
 * dependency, a missing module or export, or a value from yet another module).
 */
const importedOptionForms = (
  path: string,
  facts: ModuleFacts,
  readSource: (path: string) => string | undefined
): ReadonlyArray<string> =>
  readImportedOptions(path, facts.importedOptions, readSource, (source, target) => moduleFacts(source, target).exportedOptions)

/**
 * The skip, todo and focus forms of a source, each as `<file>:<line> <code>` (see `treeFacts`),
 * then those of its imported options values, read through `readSource`.
 */
const skipFormsIn = (
  source: string,
  fileName: string,
  readSource: (path: string) => string | undefined = readPackageFile
): ReadonlyArray<string> => {
  const facts = moduleFacts(source, fileName)
  return [...facts.forms, ...importedOptionForms(fileName, facts, readSource)]
}

/** What the skip scan of every module a walk reaches reports. */
interface ReachedScan {
  /** Every skip form of the reached modules, as `<file>:<line> <code>`. */
  readonly found: ReadonlyArray<string>
  readonly visited: ReadonlyArray<string>
}

/** The skip scan of every module that the walk from `entries` reaches, the entries included. */
const scanReached = (
  entries: ReadonlyArray<string>,
  pending: ReadonlyArray<string>,
  readSource: (path: string) => string | undefined
): ReachedScan => {
  const { visited } = walkImports(entries, pending, readSource)
  const facts = visited.map((path) => ({ path, facts: moduleFacts(readSource(path) ?? "", path) }))
  const imported = facts.flatMap((entry) => importedOptionForms(entry.path, entry.facts, readSource))
  return { visited, found: [...facts.flatMap((entry) => entry.facts.forms), ...imported] }
}

/**
 * The time limit of the tests that walk and scan every module the default run reaches. The
 * walk reads and parses each module once, but the full parallel run shares the machine with
 * every other test file, so the default 10 s limit is too tight there.
 */
const SCAN_TIMEOUT = 60_000

// ---------------------------------------------------------------- the no-skip guard of the default run

/** A fixture test file of the guard, and the lines that the guard's report must hold for it. */
interface GuardCase {
  readonly name: string
  readonly source: string
  readonly report: ReadonlyArray<string>
}

/** The imports of a fixture that uses `@effect/vitest`, and the test of each fixture that runs. */
const EFFECT_FIXTURE = {
  imports: `import { describe, it } from "@effect/vitest"\nimport { Effect } from "effect"\n`,
  runs: `it.effect("runs", () => Effect.void)\n`
} as const

/** The imports of a fixture that uses `vitest` itself, and the test of each fixture that runs. */
const VITEST_FIXTURE = {
  imports: `import { it } from "vitest"\n`,
  runs: `it("runs", () => {})\n`
} as const

/** A fixture that skips or marks todo with one form. Its file is `test/<name>.test.ts`. */
const guardCase = (
  name: string,
  fixture: typeof EFFECT_FIXTURE | typeof VITEST_FIXTURE,
  body: string,
  report: ReadonlyArray<string>
): GuardCase => ({
  name,
  source: `${fixture.imports}${body}${fixture.runs}`,
  report: report.map((entry) => entry.replace("<file>", `test/${name}.test.ts`))
})

/**
 * One fixture for each form that skips a test or marks it todo: the forms of the third Layer-3
 * review (P1 a conditional, P2 a call result, P4 an imported value, P6 an extended test API,
 * P7 the test API under another name), the literal options, the modifiers, `skipIf(true)` and a
 * test context's `ctx.skip()`. A plain `<root>.<modifier>` form is built from its parts, so this
 * file's own text never holds one for the text scan below to match.
 */
const GUARD_CASES: ReadonlyArray<GuardCase> = [
  guardCase(
    "p1-conditional-options",
    EFFECT_FIXTURE,
    `const flag = true\nit.effect("p1", () => Effect.void, flag ? { skip: true } : {})\n`,
    ["skipped test: <file> > p1"]
  ),
  guardCase(
    "p2-options-from-a-call",
    EFFECT_FIXTURE,
    `const opts = () => ({ skip: true })\ndescribe("p2", opts(), () => {\n  it.effect("inner", () => Effect.void)\n})\n`,
    ["skipped suite: <file> > p2", "skipped test: <file> > p2 > inner"]
  ),
  guardCase(
    "p4-imported-options",
    EFFECT_FIXTURE,
    `import { skipOpts } from "./skip-options.js"\ndescribe("p4", skipOpts, () => {\n  it.effect("inner", () => Effect.void)\n})\n`,
    ["skipped suite: <file> > p4", "skipped test: <file> > p4 > inner"]
  ),
  guardCase(
    "p6-extended-test-api",
    VITEST_FIXTURE,
    `const t2 = it.extend({})\nt2("p6", { skip: true }, () => {})\n`,
    ["skipped test: <file> > p6"]
  ),
  guardCase(
    "p7-aliased-test-api",
    VITEST_FIXTURE,
    `const t = it\nt("p7", { skip: true }, () => {})\n`,
    ["skipped test: <file> > p7"]
  ),
  guardCase(
    "options-skip",
    EFFECT_FIXTURE,
    `it.effect("options-skip", () => Effect.void, { skip: true })\n`,
    ["skipped test: <file> > options-skip"]
  ),
  guardCase(
    "options-skip-suite",
    EFFECT_FIXTURE,
    `describe("options-skip-suite", { skip: true }, () => {\n  it.effect("inner", () => Effect.void)\n})\n`,
    ["skipped suite: <file> > options-skip-suite", "skipped test: <file> > options-skip-suite > inner"]
  ),
  guardCase(
    "options-todo",
    EFFECT_FIXTURE,
    `it.effect("options-todo", () => Effect.void, { todo: true })\n`,
    ["todo test: <file> > options-todo"]
  ),
  guardCase(
    "modifier-skip",
    EFFECT_FIXTURE,
    `it.effect.skip("modifier-skip", () => Effect.void)\n`,
    ["skipped test: <file> > modifier-skip"]
  ),
  guardCase(
    "modifier-todo",
    EFFECT_FIXTURE,
    `${member("it", "todo")}("modifier-todo")\n`,
    ["todo test: <file> > modifier-todo"]
  ),
  guardCase(
    "modifier-todo-suite",
    EFFECT_FIXTURE,
    `${member("describe", "todo")}("modifier-todo-suite")\n`,
    ["todo suite: <file> > modifier-todo-suite"]
  ),
  guardCase(
    "skip-if",
    EFFECT_FIXTURE,
    `it.effect.skipIf(true)("skip-if", () => Effect.void)\n`,
    ["skipped test: <file> > skip-if"]
  ),
  guardCase(
    "context-skip",
    VITEST_FIXTURE,
    `it("context-skip", (ctx) => {\n  ctx.skip()\n})\n`,
    ["skipped test: <file> > context-skip"]
  )
]

/** A fixture that skips nothing: options that do not skip, and a describe block. */
const CLEAN_GUARD_CASE = guardCase(
  "clean",
  EFFECT_FIXTURE,
  `describe("clean", { timeout: 1000 }, () => {\n  it.effect("inner", () => Effect.void, { skip: false })\n})\n`,
  []
)

/** The root of the no-skip guard's fixtures: each fixture, and the helper module of P4, in `test/`. */
const guardRoot = fixtureRoot([
  ["test/skip-options.ts", `export const skipOpts = { skip: true } as const\n`],
  ...[...GUARD_CASES, CLEAN_GUARD_CASE].map(({ name, source }) => [`test/${name}.test.ts`, source] as const)
])

/**
 * The pending rewrite that the upstream config runs by name. The pending list of the pending
 * guard's fixture root lists it, and the pending rewrite of each import case (`pendingRewriteOf`).
 */
const PENDING_FIXTURE = "test/upstream/pending-rewrite.test.ts"

/** The test that each fixture rewrite declares, so a run that loads the rewrite shows the test. */
const RAN = "rewrite ran"

/**
 * One fixture for each form of an import, written for a target rewrite (the case's own pending
 * rewrite, or `green-rewrite`, which is not pending): a literal static import, a literal dynamic
 * import, the computed `import(target)` of the fourth Layer-3 review, a parameter, a
 * `new URL(...)` specifier, a helper module that re-exports the rewrite, and a computed import
 * whose failure the test catches (`caught`: Vitest passes the module's tests, so the guard fails
 * the run); then Node's own loader: a `createRequire` require, directly and through a helper
 * module that re-exports the rewrite, and a caught `createRequire` require; then the forms of
 * the fifth Layer-3 review, which name the rewrite in another letter case than the disk stores
 * it (`otherCase`): a static import of the file name in capitals, a `createRequire` require of
 * it, and a dynamic import through the folder name `Upstream`.
 */
interface ImportCase {
  readonly name: string
  readonly source: (rewrite: string) => string
  readonly caught: boolean
  /** The import names the rewrite in another letter case: it loads the rewrite only on a disk that ignores letter case. */
  readonly otherCase: boolean
}

const IMPORT_CASES: ReadonlyArray<ImportCase> = [
  { name: "literal-static-import", source: (rewrite) => `import "./upstream/${rewrite}.test.js"\n`, caught: false, otherCase: false },
  { name: "literal-dynamic-import", source: (rewrite) => `await import("./upstream/${rewrite}.test.js")\n`, caught: false, otherCase: false },
  {
    name: "computed-import",
    source: (rewrite) => `const target = "./upstream/${rewrite}.test.js"\ndescribe("hidden import", async () => {\n  await import(target)\n})\n`,
    caught: false,
    otherCase: false
  },
  {
    name: "parameter-import",
    source: (rewrite) => `const load = (path: string) => import(path)\nawait load("./upstream/${rewrite}.test.js")\n`,
    caught: false,
    otherCase: false
  },
  {
    name: "url-import",
    source: (rewrite) => `await import(new URL("./upstream/${rewrite}.test.ts", import.meta.url).href)\n`,
    caught: false,
    otherCase: false
  },
  { name: "re-exporting-helper", source: (rewrite) => `import { value } from "./${rewrite}-helper.js"\nvoid value\n`, caught: false, otherCase: false },
  {
    name: "caught-import",
    source: (rewrite) => `const target = "./upstream/${rewrite}.test.js"\nawait import(target).then(() => true, () => false)\n`,
    caught: true,
    otherCase: false
  },
  // Node's own loader, past Vite: a require from createRequire, directly and through a helper
  // module that re-exports the rewrite with Node's ESM loader. (An import() that Vitest does
  // not rewrite, such as one built by new Function, cannot load a module in a test worker:
  // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING.)
  {
    name: "native-require",
    source: (rewrite) =>
      `import { createRequire } from "node:module"\nconst load = createRequire(import.meta.url)\nload("./upstream/${rewrite}.test.ts")\n`,
    caught: false,
    otherCase: false
  },
  {
    name: "native-require-helper",
    source: (rewrite) =>
      `import { createRequire } from "node:module"\nconst load = createRequire(import.meta.url)\nload("./${rewrite}-native-helper.mjs")\n`,
    caught: false,
    otherCase: false
  },
  {
    name: "caught-native-require",
    source: (rewrite) =>
      `import { createRequire } from "node:module"\nconst load = createRequire(import.meta.url)\ntry {\n  load("./upstream/${rewrite}.test.ts")\n} catch {\n  // the guard's error\n}\n`,
    caught: true,
    otherCase: false
  },
  // Another letter case (fifth Layer-3 review): on a disk that ignores it, Vite and Node load the
  // rewrite by the path as the import typed it, and the guard looks the path up in the form the
  // disk stores it
  {
    name: "other-case-static-import",
    source: (rewrite) => `import "./upstream/${rewrite.toUpperCase()}.test.js"\n`,
    caught: false,
    otherCase: true
  },
  {
    name: "other-case-native-require",
    source: (rewrite) =>
      `import { createRequire } from "node:module"\nconst load = createRequire(import.meta.url)\nload("./upstream/${rewrite.toUpperCase()}.test.ts")\n`,
    caught: false,
    otherCase: true
  },
  {
    name: "other-case-folder",
    source: (rewrite) => `await import("./Upstream/${rewrite}.test.js")\n`,
    caught: false,
    otherCase: true
  }
]

/** The rewrite an import case loads: its own pending rewrite, or the one green rewrite. */
const rewriteOf = (target: "pending" | "green", { name }: ImportCase): string =>
  target === "pending" ? `pending-${name}` : "green-rewrite"

/**
 * The pending rewrite of an import case, as the fixture pending list names it. Each case has its
 * own, so the guard's report of a run over the files of several cases names the rewrite of each.
 */
const pendingRewriteOf = (entry: ImportCase): string => `test/upstream/${rewriteOf("pending", entry)}.test.ts`

/** The fixture file of an import case for a target rewrite: the case's import, then a test that runs. */
const importCaseFile = (target: "pending" | "green", entry: ImportCase): readonly [string, string] => [
  target === "pending" ? `test/${entry.name}.test.ts` : `test/green-${entry.name}.test.ts`,
  `import { describe, it } from "vitest"\n${entry.source(rewriteOf(target, entry))}it("runs", () => {})\n`
]

/**
 * The files of a fixture rewrite: the rewrite, whose one test is titled `<pending|green> rewrite
 * ran`, and a helper module that re-exports it, for Vite and for Node's own loader.
 */
const rewriteFiles = (rewrite: string, target: "pending" | "green"): ReadonlyArray<readonly [string, string]> => [
  [`test/upstream/${rewrite}.test.ts`, `import { it } from "vitest"\nexport const value = 1\nit("${target} ${RAN}", () => {})\n`],
  [`test/${rewrite}-helper.ts`, `export * from "./upstream/${rewrite}.test.js"\n`],
  [`test/${rewrite}-native-helper.mjs`, `export * from "./upstream/${rewrite}.test.ts"\n`]
]

/**
 * The root of the pending guard's fixtures: a pending list with `PENDING_FIXTURE` and the
 * pending rewrite of each import case, each of those rewrites and its helpers, a rewrite that is
 * not pending and its helpers, and the fixture of each import case for its pending rewrite and
 * for the green rewrite.
 */
const pendingRoot = fixtureRoot([
  [PENDING_LIST, `${JSON.stringify([PENDING_FIXTURE, ...IMPORT_CASES.map(pendingRewriteOf)])}\n`],
  ...rewriteFiles("pending-rewrite", "pending"),
  ...rewriteFiles("green-rewrite", "green"),
  ...IMPORT_CASES.flatMap((entry) => [
    ...rewriteFiles(rewriteOf("pending", entry), "pending"),
    importCaseFile("pending", entry),
    importCaseFile("green", entry)
  ])
])

/** One run of Vitest on one file of `root` through the default config (see `runWithConfig`). */
const runWithDefaultConfig = (root: string, file: string, overrides: { readonly reporters?: Array<string> } = {}) =>
  runWithConfig("vitest.config.ts", root, [file], overrides)

describe("HARNESS-2 conformance harness configuration", () => {
  it.effect("[HARNESS-2] the default run collects test/*.test.ts and test/verify/**/*.spec.ts and never test/upstream/**", () =>
    Effect.gen(function* () {
      const { default: config } = yield* importModule<VitestConfigModule>("vitest.config.ts")
      assert.deepStrictEqual(sorted(config.test.include), sorted(["test/*.test.ts", "test/verify/**/*.spec.ts"]))
      assert.isTrue(matchesAny("test/upstream/actions.test.ts", config.test.exclude ?? []))

      const expected = sorted([
        ...globSync("test/*.test.ts", { cwd: pkgRoot }),
        ...globSync("test/verify/**/*.spec.ts", { cwd: pkgRoot })
      ])
      const collected = collectedFiles(config.test)
      assert.deepStrictEqual(collected, expected)
      assert.include(collected, "test/verify/verify-xstate-5-33-2-port-HARNESS-2.spec.ts")
      assert.isFalse(collected.some((path) => path.startsWith("test/upstream/")))

      for (const path of [
        "test/upstream/actions.test.ts",
        "test/upstream/examples/6.6.test.ts",
        "test/upstream/graph/graph.test.ts",
        "test/upstream/utils.ts"
      ]) {
        assert.isFalse(isCollected(config.test, path), `${path} must stay out of the default run`)
      }
      for (const path of ["test/machine.test.ts", "test/verify/nested/verify-x.spec.ts"]) {
        assert.isTrue(isCollected(config.test, path), `${path} must be in the default run`)
      }
    }))

  it.effect("[HARNESS-2] pending.json lists each upstream rewrite whose green phase is still ahead: exactly the rewrites that no CONF evidence file imports", () =>
    Effect.sync(() => {
      const pending = pendingRewrites()
      assert.strictEqual(new Set(pending).size, pending.length, "pending.json lists each path once")

      // A rewrite turns green when its CONF-n evidence file imports it (SD-1, SD-2)
      const imported = new Set(
        confEvidenceSources(join(pkgRoot, "test/verify")).flatMap(({ file, source }) =>
          importsOf(source, file).flatMap((entry) => (entry.file === null ? [] : [`test/upstream/${entry.file}.test.ts`]))
        )
      )
      // The export-parity test (EXP-1) is no rewrite: its evidence file imports it, and pending.json never lists it
      const rewrites = globSync("test/upstream/**/*.test.ts", { cwd: pkgRoot }).filter(
        (path) => !isNonTestFile(path.replace(/^test\/upstream\//, ""))
      )
      assert.isAbove(imported.size, 0)
      for (const path of imported) {
        assert.include(rewrites, path, `${path} is imported by a CONF evidence file`)
      }
      assert.deepStrictEqual(
        sorted(pending.filter((path) => path.endsWith(".test.ts"))),
        sorted(rewrites.filter((path) => !imported.has(path)))
      )
    }))

  it.effect("[HARNESS-2] the default config runs the no-skip guard and the pending-rewrite guard beside the default reporter, and the upstream config leaves the pending-rewrite guard out", () =>
    Effect.gen(function* () {
      const { default: config, flakyTestSetup, pendingRewriteSetup } = yield* importModule<VitestConfigModule>("vitest.config.ts")
      const reporters = config.test.reporters ?? []
      assert.strictEqual(reporters.length, 3)
      assert.strictEqual(reporters[0], "default")
      assert.instanceOf(reporters[1], NoSkipReporter)
      const pendingGuard = reporters[2]
      assert.instanceOf(pendingGuard, PendingRewriteGuard)
      // The guard's plugin is the one plugin of the default run, so each load through Vite passes it
      assert.strictEqual(config.plugins?.length, 1)
      assert.strictEqual(config.plugins?.[0], pendingGuard.plugin)
      assert.strictEqual(pendingGuard.plugin.name, PENDING_GUARD_PLUGIN)
      // The guard's setup file is the first setup file, by absolute path, so each test worker
      // registers the hook for the loads through Node's own loader; the flakyTest guard's setup
      // file (CONF-8) is the other one
      const setupFile = join(pkgRoot, "test/verify/pending-rewrite-setup.ts")
      const flakyTestSetupFile = join(pkgRoot, "test/verify/flaky-test-setup.ts")
      assert.strictEqual(pendingRewriteSetup, setupFile)
      assert.strictEqual(flakyTestSetup, flakyTestSetupFile)
      assert.deepStrictEqual(config.test.setupFiles, [setupFile, flakyTestSetupFile])
      // The fs module cache serves a cached module without the transform hook: the default run keeps it off
      assert.notStrictEqual(config.test.fsModuleCache, true)
      // A --reporter flag would replace the config's reporters: the test script has none (the
      // script test below asserts the exact script)
      assert.notInclude(packageJson().scripts["test"], "--reporter")

      // The upstream config runs a named pending rewrite: no plugin, no pending-rewrite guard
      // and no setup file of it, only the flakyTest guard's setup file (CONF-8: every config
      // gives the flakyTest guard)
      const { default: upstream } = yield* importModule<VitestConfigModule>("vitest.upstream.config.ts")
      assert.deepStrictEqual(upstream.plugins, [])
      assert.deepStrictEqual(upstream.test.setupFiles, [flakyTestSetupFile])
      const upstreamReporters = upstream.test.reporters ?? []
      assert.strictEqual(upstreamReporters.length, 2)
      assert.strictEqual(upstreamReporters[0], "default")
      assert.instanceOf(upstreamReporters[1], NoSkipReporter)
    }))

  it.effect("[HARNESS-2] no pending rewrite is executed: a run through the default config that loads a pending rewrite fails, whatever form the import takes and whatever letter case it names the path in, and the pending-rewrite guard names the canonical path; the upstream config runs the rewrite when it is named", () =>
    Effect.gen(function* () {
      const root = yield* pendingRoot
      // A path in another letter case names the file on a disk that ignores letter case (macOS
      // APFS by default), and no file on a disk that keeps it
      const ignoresCase = existsSync(join(root, PENDING_LIST.toUpperCase()))
      const loads = (entry: ImportCase): boolean => !entry.otherCase || ignoresCase
      const pendingTests = (run: GuardRun) => run.tests.filter((test) => test.endsWith(` > pending ${RAN}`))

      // Each case loads a pending rewrite of its own, so the report of one run over the files of
      // several cases shows what each case loaded. One run takes the cases whose failed import
      // Vitest sees, one the cases that catch it: there Vitest passes each file, so the guard
      // alone fails the run
      for (const caught of [false, true]) {
        const cases = IMPORT_CASES.filter((entry) => entry.caught === caught)
        const files = sorted(cases.map((entry) => importCaseFile("pending", entry)[0]))
        const label = caught ? "the run of the caught imports" : "the run of the imports Vitest sees fail"
        const run = yield* runWithConfig("vitest.config.ts", root, files)
        assert.deepStrictEqual(run.modules, files, `${label} collects each of its files`)
        assert.strictEqual(run.exitCode, 1, `${label} must fail`)
        assert.deepStrictEqual(
          run.pendingReport,
          sorted(cases.filter(loads).map(pendingRewriteOf)),
          `the guard must name the canonical path of the pending rewrite that each case of ${label} loads`
        )
        assert.deepStrictEqual(pendingTests(run), [], `no pending rewrite may run in ${label}`)
        // The guard's plugin or hook fails the import, so Vitest fails the file; when the test
        // catches that failure, Vitest passes the file and the guard alone fails the run
        for (const entry of cases) {
          const [file] = importCaseFile("pending", entry)
          assert.strictEqual(run.passed.includes(file), entry.caught, `Vitest ${entry.caught ? "passes" : "fails"} ${entry.name} itself`)
        }
        assert.strictEqual(run.ok, caught, `Vitest itself ${caught ? "passes" : "fails"} ${label}`)
        assert.deepStrictEqual(run.report, [])
      }

      // Control: the same forms load a rewrite that is not pending, and it runs, in each file;
      // the guard reports nothing and the run passes. A form in another letter case loads it
      // only on a disk that ignores letter case
      const greenFiles = sorted(IMPORT_CASES.filter(loads).map((entry) => importCaseFile("green", entry)[0]))
      const green = yield* runWithConfig("vitest.config.ts", root, greenFiles)
      assert.deepStrictEqual(green.modules, greenFiles)
      assert.isTrue(green.ok)
      assert.include([undefined, 0], green.exitCode, "a run that loads no pending rewrite must pass")
      assert.deepStrictEqual(green.pendingReport, [])
      for (const file of greenFiles) {
        assert.isTrue(
          green.tests.some((test) => test.startsWith(`${file} > `) && test.endsWith(` > green ${RAN}`)),
          `the rewrite that ${file} imports must run`
        )
      }

      // The upstream config runs a pending rewrite when it is named, and the guard stays silent
      const named = yield* runWithConfig("vitest.upstream.config.ts", root, [PENDING_FIXTURE])
      assert.deepStrictEqual(named.modules, [PENDING_FIXTURE])
      assert.isTrue(named.ok)
      assert.include([undefined, 0], named.exitCode, "the upstream run of a named pending rewrite must pass")
      assert.deepStrictEqual(named.pendingReport, [])
      assert.deepStrictEqual(named.tests, [`${PENDING_FIXTURE} > pending ${RAN}`])
    }), SCAN_TIMEOUT)

  it.effect("[HARNESS-2] no test is skipped: a run through the default config in which any test or suite ends skipped or todo fails, and the no-skip guard names each one, whatever form skipped it", () =>
    Effect.gen(function* () {
      const root = yield* guardRoot
      for (const { name, report } of GUARD_CASES) {
        const file = `test/${name}.test.ts`
        const run = yield* runWithDefaultConfig(root, file)
        assert.deepStrictEqual(run.modules, [file], `the run of ${name} collects its one file`)
        assert.isTrue(run.ok, `Vitest itself fails no test in ${name}, so the guard alone fails the run`)
        assert.strictEqual(run.exitCode, 1, `the run of ${name} must fail`)
        assert.deepStrictEqual(run.report, report, `the guard must name each skipped or todo entry of ${name}`)
      }

      // A clean file passes, and the guard reports nothing
      const cleanFile = `test/${CLEAN_GUARD_CASE.name}.test.ts`
      const clean = yield* runWithDefaultConfig(root, cleanFile)
      assert.deepStrictEqual(clean.modules, [cleanFile])
      assert.isTrue(clean.ok)
      assert.include([undefined, 0], clean.exitCode, "a clean run must pass")
      assert.deepStrictEqual(clean.report, [])

      // Control: without the guard, Vitest passes a run with a skipped test, so the guard is
      // what fails the runs above
      const [skipped] = GUARD_CASES
      assert.isDefined(skipped)
      const unguarded = yield* runWithDefaultConfig(root, `test/${skipped.name}.test.ts`, { reporters: ["default"] })
      assert.isTrue(unguarded.ok)
      assert.include([undefined, 0], unguarded.exitCode, "Vitest alone passes a skipped test")
      assert.deepStrictEqual(unguarded.report, [])
    }), SCAN_TIMEOUT)

  it.effect("[HARNESS-2] no test in the default run is skipped, todo or focused", () =>
    Effect.gen(function* () {
      const { default: config } = yield* importModule<VitestConfigModule>("vitest.config.ts")
      const modifier = new RegExp("\\b(it|test|describe)\\.(skip|skipIf|runIf|todo|only)\\b")
      const offenders = collectedFiles(config.test).filter((path) => modifier.test(readText(path)))
      assert.deepStrictEqual(offenders, [])
    }))

  it.effect("[HARNESS-2] no test in the default run is skipped, todo or focused: the syntax-tree scan of every module the default run reaches finds no skip form", () =>
    Effect.gen(function* () {
      // The forms the scan must find. A plain `<root>.<modifier>` form is built from its parts,
      // so this file's own text never holds one for the text scan above to match.
      const flagged = [
        `it.effect.skip("x", () => Effect.void)`,
        `it.effect.skipIf(true)("x", () => Effect.void)`,
        `it.effect.runIf(false)("x", () => Effect.void)`,
        `it.effect.only("x", () => Effect.void)`,
        `it.effect.todo("x")`,
        `it.live.skip("x", () => Effect.void)`,
        `it.effect("x", (ctx) => {\n  ctx.skip()\n  return Effect.void\n})`,
        `it["skip"]("x", () => {})`,
        `const later = it.effect.skip`,
        `describe.concurrent.only("d", () => {})`,
        `${member("it", "skip")}("x", () => {})`,
        `${member("test", "todo")}("x")`,
        `${member("test", "runIf")}(false)("x", () => {})`,
        `${member("describe", "only")}("d", () => {})`,
        `${member("describe", "skipIf")}(true)("d", () => {})`,
        `${member("suite", "skip")}("d", () => {})`,
      ]
      for (const fixture of flagged) {
        assert.strictEqual(skipFormsIn(fixture, "fixture.spec.ts").length, 1, `the scan must find one skip form in: ${fixture}`)
      }
      // The Vitest options forms, the test context's skip under its own name, and the test API
      // under another name: each with the exact code the scan reports
      const flaggedAs: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [`describe("d", { skip: true }, () => {})`, ["skip: true"]],
        [`it.effect("x", () => Effect.void, { skip: true })`, ["skip: true"]],
        [`it.effect("x", () => Effect.void, { todo: true })`, ["todo: true"]],
        [`it("x", { todo: true }, () => {})`, ["todo: true"]],
        [`describe("d", { ...opts, only: true }, () => {})`, ["...opts", "only: true"]],
        [`test("x", { only: process.env["FOCUS"] === "1" }, () => {})`, [`only: process.env["FOCUS"] === "1"`]],
        [`describe("d", { "skip": true } as const, () => {})`, [`"skip": true`]],
        [`describe("d", { skip }, () => {})`, ["skip"]],
        [`it.effect("x", () => Effect.void, { ...shared })`, ["...shared"]],
        [`it.effect("x", () => Effect.void, { [mode]: true })`, ["[mode]: true"]],
        [`it.effect.each([1, 2])("x %i", () => Effect.void, { skip: true })`, ["skip: true"]],
        [`const options = { timeout: 5, skip: true }\ndescribe("d", options, () => {})`, ["skip: true"]],
        [`it("x", ({ skip }) => {\n  skip()\n})`, ["skip()"]],
        [`it.effect("x", (ctx) => {\n  const { skip: pass } = ctx\n  pass()\n  return Effect.void\n})`, ["pass()"]],
        [`const t = it\nt.only("x", () => {})`, ["t.only"]],
        [`const { todo } = test\ntodo("x")`, [`todo("x")`]],
        [`import { describe as group } from "vitest"\ngroup("d", { skip: true }, () => {})`, ["skip: true"]],
        [`import * as vitest from "@effect/vitest"\nconst later = vitest.it.effect.only`, ["vitest.it.effect.only"]],
        // The forms of the third Layer-3 review, read through the module: P1 a conditional,
        // P2 a local function's result, P6 an extended test API, P7 the test API under another name
        [`const flag = true\nit.effect("p1", () => Effect.void, flag ? { skip: true } : {})`, ["skip: true"]],
        [`const opts = () => ({ skip: true })\ndescribe("p2", opts(), () => {})`, ["skip: true"]],
        [`function opts() {\n  return { todo: true }\n}\ndescribe("d", opts(), () => {})`, ["todo: true"]],
        [`const t2 = it.extend({})\nt2("p6", { skip: true }, () => {})`, ["skip: true"]],
        [`const t = it\nt("p7", { skip: true }, () => {})`, ["skip: true"]],
        [`const a = it\nconst b = a\nb("x", () => {}, { todo: true })`, ["todo: true"]],
        [`const options = flag ? shared : { timeout: 5 }\ndescribe("d", options, () => {})`, ["shared"]],
        // An options value the scan cannot read is reported: a call, a member, a parameter, an
        // import it cannot resolve (P4 resolves its import in the reached-module test below)
        [`it.effect("x", () => Effect.void, makeOptions(flag))`, ["makeOptions(flag)"]],
        [`describe("d", shared.options, () => {})`, ["shared.options"]],
        [`const check = (options: object) => it("x", options, () => {})`, ["options"]],
        [`import { skipOpts } from "./nowhere.js"\ndescribe("d", skipOpts, () => {})`, ["skipOpts"]],
        [`import { makeOptions } from "some-package"\ndescribe("d", makeOptions(), () => {})`, ["makeOptions()"]],
      ]
      for (const [fixture, codes] of flaggedAs) {
        assert.deepStrictEqual(skipFormsIn(fixture, "fixture.spec.ts").map(codeOf), codes, `the scan must find ${codes.join(", ")} in: ${fixture}`)
      }
      // Code that only looks alike is not found: a running test, a table, a string, a comment,
      // a count named skip, options that do not skip, a machine state named todo
      const clean = [
        `it.effect("x", () => Effect.void)`,
        `it.effect.each([1, 2])("x %i", () => Effect.void)`,
        `describe("d", () => {})`,
        `const total = upstream.skip + upstream.todo + manifest.totals.only`,
        `const kinds = ofKind(["skip", "todo"])`,
        `// ${member("it", "skip")} is written as a comment here`,
        `const text = "${member("describe", "only")}"`,
        `describe("d", { shuffle: false }, () => {})`,
        `describe("d", { skip: false, only: false }, () => {})`,
        `it.effect("x", () => Effect.void, { timeout: 1000 })`,
        `const options = { timeout: 5 }\ndescribe("d", options, () => {})`,
        `const machine = createMachine({ states: { todo: { on: { skip: "done" } } } })`,
        `const { skip, todo } = totals\nconst sum = skip + todo`,
        `it("x", ({ task }) => {\n  void task\n})`,
        `const LIMIT = 60_000\nit.effect("x", () => Effect.void, LIMIT)`,
        `const opts = () => ({ timeout: 5 })\ndescribe("d", opts(), () => {})`,
        `it.effect("x", () => Effect.void, flag ? { timeout: 5 } : {})`,
        `it.effect.prop("x", [Schema.Number], () => Effect.void)`,
        `const body = () => Effect.void\nit.effect("x", body)`,
      ]
      for (const fixture of clean) {
        assert.deepStrictEqual(skipFormsIn(fixture, "fixture.spec.ts"), [], fixture)
      }

      const { default: config } = yield* importModule<VitestConfigModule>("vitest.config.ts")
      // A name pattern skips each test whose name it does not match
      assert.isUndefined(config.test.testNamePattern)
      const files = collectedFiles(config.test)
      assert.include(files, "test/verify/verify-xstate-5-33-2-port-HARNESS-2.spec.ts")
      assert.deepStrictEqual(files.flatMap((path) => skipFormsIn(readText(path), path)), [])

      // Every module the collected files reach by import declares tests in the default run too:
      // the helpers (conformance.ts declares each CONF check) and the green rewrites
      const reached = scanReached(files, pendingRewrites(), readPackageFile)
      for (const path of [...files, "test/verify/conformance.ts", "test/upstream/scxml.test.ts", "test/upstream/utils.ts"]) {
        assert.include(reached.visited, path)
      }
      assert.deepStrictEqual(reached.found, [])
    }), SCAN_TIMEOUT)

  it.effect("[HARNESS-2] no test in the default run is skipped: the scan reads each module a collected file reaches by import, in test/ or outside it", () =>
    Effect.sync(() => {
      // Negative fixtures: a default-run file (in memory) and the modules it reaches (in memory);
      // every other path is read from the package
      const probe = "test/verify/verify-probe.spec.ts"
      const found = (files: Readonly<Record<string, string>>): ReadonlyArray<string> =>
        scanReached([probe], [], (path) => files[path] ?? readPackageFile(path)).found
      const skipped = member("it", "skip")
      const focused = member("describe", "only")

      // A helper that declares the tests of a suite, as conformance.ts does, one of them skipped
      assert.deepStrictEqual(
        found({
          [probe]: `import { probeSuite } from "./probe-helper.js"\nprobeSuite()\n`,
          "test/verify/probe-helper.ts": `import { it } from "@effect/vitest"\nexport const probeSuite = (): void => {\n  ${skipped}("x", () => {})\n}\n`,
        }),
        [`test/verify/probe-helper.ts:3 ${skipped}`]
      )
      // Two imports away, through a re-export, in the options form
      assert.deepStrictEqual(
        found({
          [probe]: `import "./probe-helper.js"\n`,
          "test/verify/probe-helper.ts": `export * from "../upstream/probe-rewrite.test.js"\n`,
          "test/upstream/probe-rewrite.test.ts": `import { describe } from "@effect/vitest"\ndescribe("d", { skip: true }, () => {})\n`,
        }),
        ["test/upstream/probe-rewrite.test.ts:2 skip: true"]
      )
      // Outside test/, by a relative path and through the `@` alias, and in a JavaScript module
      assert.deepStrictEqual(
        found({
          [probe]: `import "../../scripts/probe.js"\n`,
          "scripts/probe.ts": `${focused}("d", () => {})\n`,
        }),
        [`scripts/probe.ts:1 ${focused}`]
      )
      assert.deepStrictEqual(
        found({
          [probe]: `import { probe } from "@/probe.js"\n`,
          "src/probe.ts": `export const probe = it.effect("x", () => Effect.void, { todo: true })\n`,
        }),
        ["src/probe.ts:1 todo: true"]
      )
      assert.deepStrictEqual(
        found({
          [probe]: `import "./probe-helper.mjs"\n`,
          "test/verify/probe-helper.mjs": `test("x", { only: true }, () => {})\n`,
        }),
        ["test/verify/probe-helper.mjs:1 only: true"]
      )
      // A dynamic import inside a describe block, as a CONF evidence file imports a rewrite
      assert.deepStrictEqual(
        found({
          [probe]: `describe("upstream/probe.test.ts", async () => {\n  await import("../upstream/probe.test.js")\n})\n`,
          "test/upstream/probe.test.ts": `it.effect.skip("x", () => Effect.void)\n`,
        }),
        ["test/upstream/probe.test.ts:1 it.effect.skip"]
      )

      // P4: an options value imported from a helper is read in the helper. P8, the same value
      // in a spread, is reported as a spread
      const helper = { "test/verify/probe-helper.ts": `export const skipOpts = { skip: true } as const\n` }
      const importsSkipOpts = `import { describe } from "@effect/vitest"\nimport { skipOpts } from "./probe-helper.js"\n`
      assert.deepStrictEqual(
        found({ ...helper, [probe]: `${importsSkipOpts}describe("d", skipOpts, () => {})\n` }),
        [`${probe}:3 skipOpts`, "test/verify/probe-helper.ts:1 skip: true"]
      )
      assert.deepStrictEqual(
        found({ ...helper, [probe]: `${importsSkipOpts}describe("d", { ...skipOpts }, () => {})\n` }),
        [`${probe}:3 ...skipOpts`]
      )
      // P3: the options that the describe block of each CONF file takes from
      // upstreamFileOptions() are read in conformance.ts. Today they hold no skip option; with
      // one, each call is reported
      const confProbe = `import { describe } from "@effect/vitest"\nimport { upstreamFileOptions } from "./conformance.js"\ndescribe("upstream/x.test.ts", upstreamFileOptions(), () => {})\n`
      assert.deepStrictEqual(found({ [probe]: confProbe }), [])
      const skippingReturn = "return { shuffle: file?.shuffle === true, skip: true }"
      const skipping = replaceOnce(readText("test/verify/conformance.ts"), "return { shuffle: file?.shuffle === true }", skippingReturn)
      const skippingLine = skipping.slice(0, skipping.indexOf(skippingReturn)).split("\n").length
      assert.deepStrictEqual(
        found({ [probe]: confProbe, "test/verify/conformance.ts": skipping }),
        [`${probe}:3 upstreamFileOptions()`, `test/verify/conformance.ts:${skippingLine} skip: true`]
      )
    }), SCAN_TIMEOUT)

  it.effect("[HARNESS-2] the skip scan has no exemption: upstream's onlyTests switch is reported in any module, the SCXML rewrite included, also while onlyTests is empty", () =>
    Effect.sync(() => {
      // Upstream's switch as upstream test/scxml.test.ts writes it: dead code while the list is
      // empty, but its two forms focus one case and skip every other once the list names one
      const upstreamSwitch = [
        `import { it } from "@effect/vitest"`,
        "const onlyTests: string[] = []",
        "const execTest = onlyTests.length",
        `  ? onlyTests.includes("test208.txml") ? it.effect.only : it.effect.skip`,
        "  : it.effect",
        `execTest("x", () => Effect.void)`,
        ""
      ].join("\n")
      for (const path of ["test/upstream/scxml.test.ts", "test/upstream/probe.test.ts"]) {
        assert.deepStrictEqual(
          skipFormsIn(upstreamSwitch, path).map(codeOf),
          ["it.effect.only", "it.effect.skip"],
          `the scan must report the switch in ${path}`
        )
      }
      // The SCXML rewrite filters its case list instead, and holds no form
      assert.deepStrictEqual(skipFormsIn(readText("test/upstream/scxml.test.ts"), "test/upstream/scxml.test.ts"), [])
    }), SCAN_TIMEOUT)

  it.effect("[HARNESS-2] no file the default run collects imports a pending rewrite, directly or through the test modules it imports", () =>
    Effect.gen(function* () {
      // Negative fixtures: default-run files (in memory) that reach a path of a fixture pending
      // list; every other path is read from the package. The fixture list stays fixed when a
      // rewrite graduates from the real pending.json.
      const fixturePending = [
        "test/upstream/clock.test.ts",
        "test/upstream/history.test.ts",
        "test/upstream/actions.test.ts",
        "test/upstream/graph/testUtils.ts",
      ]
      const withFiles = (files: Readonly<Record<string, string>>) => (path: string): string | undefined =>
        files[path] ?? readPackageFile(path)
      const probe = "test/verify/verify-probe.spec.ts"
      const reach = (files: Readonly<Record<string, string>>, entry = probe) =>
        walkImports([entry], fixturePending, withFiles(files)).problems
      assert.deepStrictEqual(reach({ [probe]: `import "../upstream/clock.test.js"\n` }), [`${probe} imports test/upstream/clock.test.ts`])
      assert.deepStrictEqual(
        reach({ [probe]: `describe("upstream/clock.test.ts", () => {\n  void import("../upstream/clock.test.js")\n})\n` }),
        [`${probe} imports test/upstream/clock.test.ts`]
      )
      assert.deepStrictEqual(
        reach({ [probe]: `export { machine } from "../upstream/history.test.js"\n` }),
        [`${probe} imports test/upstream/history.test.ts`]
      )
      assert.deepStrictEqual(
        reach({ "test/probe.test.ts": `import type { Probe } from "./upstream/actions.test.js"\n` }, "test/probe.test.ts"),
        ["test/probe.test.ts imports test/upstream/actions.test.ts"]
      )
      assert.deepStrictEqual(
        reach({
          [probe]: `import { probe } from "./probe-helper.js"\n`,
          "test/verify/probe-helper.ts": `export * from "../upstream/graph/testUtils"\n`,
        }),
        ["test/verify/probe-helper.ts imports test/upstream/graph/testUtils.ts"],
        "an import through a helper module is found"
      )
      assert.deepStrictEqual(
        reach({
          [probe]: `import { probe } from "@/probe.js"\n`,
          "src/probe.ts": `export { probe } from "../scripts/probe.js"\n`,
          "scripts/probe.ts": `export * from "../test/upstream/clock.test.js"\n`,
        }),
        ["scripts/probe.ts imports test/upstream/clock.test.ts"],
        "an import through modules outside test/, the first through the @ alias, is found"
      )
      // A specifier that names a pending rewrite or its folder in another letter case: on a disk
      // that ignores letter case it loads the rewrite, and the walk names its canonical path; on
      // a disk that keeps letter case it names no file, and the walk reports that as a problem. A
      // require that a variable holds is also a loader reference that the walk reports (CONF-8,
      // the fifth Layer-3 review), and the walk still follows its calls
      const ignoresCase = existsSync(join(pkgRoot, "PACKAGE.JSON"))
      const otherCaseForms: ReadonlyArray<readonly [string, string, string, string, ReadonlyArray<string>]> = [
        ["a static import of the file name in capitals", `import "../upstream/CLOCK.test.js"\n`, "../upstream/CLOCK.test.js", "test/upstream/clock.test.ts", []],
        [
          "a createRequire require of the file name in another case",
          `import { createRequire } from "node:module"\nconst require = createRequire(import.meta.url)\nrequire("../upstream/graph/TestUtils.ts")\n`,
          "../upstream/graph/TestUtils.ts",
          "test/upstream/graph/testUtils.ts",
          [`${probe}:2 createRequire(import.meta.url) is a loader reference that the walk cannot follow`]
        ],
        ["a dynamic import through the folder name in another case", `await import("../Upstream/history.test.js")\n`, "../Upstream/history.test.js", "test/upstream/history.test.ts", []],
      ]
      for (const [label, source, specifier, path, loaderReferences] of otherCaseForms) {
        assert.deepStrictEqual(
          reach({ [probe]: source }),
          [
            ...loaderReferences,
            ignoresCase ? `${probe} imports ${path}` : `${probe}: ${JSON.stringify(specifier)} names no file that the walk can read`
          ],
          `the walk must name ${path} for ${label}`
        )
      }

      // A green rewrite and the package itself are not pending
      const green = walkImports(
        [probe],
        fixturePending,
        withFiles({ [probe]: `import "../upstream/deep.test.js"\nimport { createActor } from "../../src/index.js"\n` })
      )
      assert.deepStrictEqual(green.problems, [])
      assert.include(green.visited, "test/upstream/deep.test.ts", "the walk follows an import into a rewrite")

      // An import whose specifier is not a string literal names a module the walk cannot read:
      // the walk reports it, in a collected file or in a module it reaches (the run-time guard
      // blocks what such an import loads)
      const unreadable = (code: string) => `${code} names a module the walk cannot read`
      const unreadableForms: ReadonlyArray<readonly [string, string]> = [
        [`const target = "../upstream/clock.test.js"\nawait import(target)\n`, `${probe}:2 import(target)`],
        [`const load = (path: string) => import(path)\nawait load("../upstream/clock.test.js")\n`, `${probe}:1 import(path)`],
        [
          `await import(new URL("../upstream/clock.test.ts", import.meta.url).href)\n`,
          `${probe}:1 import(new URL("../upstream/clock.test.ts", import.meta.url).href)`
        ],
        [`const name = "clock"\nawait import(\`../upstream/\${name}.test.js\`)\n`, `${probe}:2 import(\`../upstream/\${name}.test.js\`)`],
        [`const target = "../upstream/clock.test.js"\nrequire(target)\n`, `${probe}:2 require(target)`],
        [`const target = "../upstream/clock.test.js"\nawait vi.importActual(target)\n`, `${probe}:2 vi.importActual(target)`],
      ]
      for (const [source, code] of unreadableForms) {
        assert.deepStrictEqual(reach({ [probe]: source }), [unreadable(code)], `the walk must report: ${source}`)
      }
      assert.deepStrictEqual(
        reach({
          [probe]: `import "./probe-helper.js"\n`,
          "test/verify/probe-helper.ts": `export const load = (target: string) => import(target)\n`,
        }),
        [unreadable("test/verify/probe-helper.ts:1 import(target)")],
        "an unreadable import in a module the walk reaches is reported"
      )
      // A literal in a template without substitutions is read
      assert.deepStrictEqual(reach({ [probe]: "await import(`../upstream/clock.test.js`)\n" }), [`${probe} imports test/upstream/clock.test.ts`])

      // The named exemption: this file's importModule. Its literal arguments are read as paths
      // from the package root, so the walk follows them and finds a pending one
      const self = IMPORT_MODULE.file
      const selfSource = readText(self)
      const selfWalk = walkImports([self], fixturePending, withFiles({}))
      assert.deepStrictEqual(selfWalk.problems, [])
      for (const path of ["vitest.config.ts", "vitest.upstream.config.ts", "eslint.config.mjs", "test/verify/pending-rewrite-guard.ts"]) {
        assert.include(selfWalk.visited, path, `importModule loads ${path}`)
      }
      // Each fixture is this file with one more line at its end, so the import keeps its line
      const importLine = selfSource.split("\n").findIndex((line) => line.startsWith(`  Effect.promise(() => ${IMPORT_MODULE.code}`)) + 1
      assert.isAbove(importLine, 0)
      const exemptionFixtures: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>]> = [
        [
          "a pending path given to importModule",
          self,
          `${selfSource}\nvoid importModule("test/upstream/clock.test.ts")\n`,
          [`${self} imports test/upstream/clock.test.ts`]
        ],
        [
          "importModule given a value the walk cannot read",
          self,
          `${selfSource}\nvoid importModule(upstreamConfigFile)\n`,
          [unreadable(`${self}:${importLine} ${IMPORT_MODULE.code}`)]
        ],
        [
          "importModule passed on",
          self,
          `${selfSource}\nconst loader = importModule\n`,
          [unreadable(`${self}:${importLine} ${IMPORT_MODULE.code}`)]
        ],
        [
          "the same importModule in another module",
          "test/verify/verify-probe.spec.ts",
          `const importModule = (relative: string) => import(pathToFileURL(join(pkgRoot, relative)).href)\nvoid importModule("vitest.config.ts")\n`,
          [unreadable(`test/verify/verify-probe.spec.ts:1 ${IMPORT_MODULE.code}`)]
        ],
      ]
      for (const [label, path, source, expected] of exemptionFixtures) {
        const problems = walkImports([path], fixturePending, withFiles({ [path]: source })).problems
        assert.deepStrictEqual(problems, expected, `the walk must report ${label}`)
      }

      // The real default run against the real pending.json
      const pending = pendingRewrites()
      const { default: config } = yield* importModule<VitestConfigModule>("vitest.config.ts")
      // The walk resolves the default config's `@` alias. Its other alias gives the flakyTest
      // guard's module (CONF-8) for each import of @effect/vitest, so the walk reads that module
      // from the files of the run too. Another alias needs the walk to follow it
      const flakyTestGuard = "test/verify/flaky-test-guard.ts"
      assert.deepStrictEqual(config.resolve?.alias, [
        { find: "@", replacement: "./src" },
        { find: /^@effect\/vitest(?=[?#]|$)/, replacement: join(pkgRoot, flakyTestGuard) }
      ])
      const walk = walkImports([...collectedFiles(config.test), flakyTestGuard], pending, readPackageFile)
      assert.deepStrictEqual(walk.problems, [])
      // The walk reaches the green rewrites CONF evidence files import, and their helpers
      for (const path of ["test/upstream/scxml.test.ts", "test/upstream/support/scxml.ts", "test/upstream/id.test.ts", "test/upstream/utils.ts", flakyTestGuard]) {
        assert.include(walk.visited, path)
      }
      for (const path of pending) {
        assert.notInclude(walk.visited, path, `${path} is pending and must not be reached`)
      }
    }), SCAN_TIMEOUT)

  it.effect("[HARNESS-2] test and test:upstream run with CI=true and test:upstream uses the upstream config", () =>
    Effect.gen(function* () {
      const { scripts } = packageJson()
      assert.strictEqual(scripts["test"], "CI=true vitest run")
      assert.strictEqual(scripts["test:upstream"], "CI=true vitest run --config vitest.upstream.config.ts")

      const { default: upstream } = yield* importModule<VitestConfigModule>("vitest.upstream.config.ts")
      assert.deepStrictEqual([...upstream.test.include], ["test/upstream/**/*.test.ts"])
      for (const path of [PENDING_PROBE, "test/upstream/examples/6.6.test.ts", ...pendingRewrites()]) {
        if (path.endsWith(".test.ts")) {
          assert.isTrue(isCollected(upstream.test, path), `${path} must run when named to test:upstream`)
        }
      }
      assert.isFalse(isCollected(upstream.test, "test/machine.test.ts"))
    }))

  it.effect("[HARNESS-2] typecheck runs tsc on src and on the green test config", () =>
    Effect.sync(() => {
      assert.strictEqual(
        packageJson().scripts["typecheck"],
        "tsc --noEmit && tsc -p tsconfig.test.green.json --noEmit"
      )
    }))

  it.effect("[HARNESS-2] the green config exclude equals pending.json plus the COMPAT-1 legacy entries", () =>
    Effect.sync(() => {
      const green = readJson("tsconfig.test.green.json") as TsConfig
      const base = readJson("tsconfig.test.json") as TsConfig
      const legacy = readJson("test/verify/fixtures/green-exclude-compat-1.json") as ReadonlyArray<LegacyExclude>
      const pending = pendingRewrites()

      assert.strictEqual(green.extends, "./tsconfig.test.json")
      assert.isUndefined(green.include)
      assert.isUndefined(green.files)
      assert.include(base.include ?? [], "test/**/*.ts")

      const expected = sorted([...pending, ...legacy.map((entry) => entry.path)])
      assert.deepStrictEqual(sorted(green.exclude), expected)
      assert.strictEqual(new Set(expected).size, expected.length)

      for (const entry of legacy) {
        assert.strictEqual(entry.owner, "T8.6", `${entry.path} must name the COMPAT-1 task as owner`)
        assert.strictEqual(entry.scenario, "COMPAT-1")
        assert.isAbove(entry.reason.length, 0)
        assert.isFalse(entry.path.startsWith("test/upstream/"))
        assert.isFalse(entry.path.startsWith("test/verify/"))
      }
    }))

  it.effect("[HARNESS-2] lint runs the cached eslint command over src and test", () =>
    Effect.sync(() => {
      assert.strictEqual(
        packageJson().scripts["lint"],
        "eslint --cache --cache-location node_modules/.cache/eslint src test"
      )
    }))

  it.effect("[HARNESS-2] a file listed in pending.json is not linted and a file removed from the list is linted", () =>
    Effect.gen(function* () {
      const withPending = yield* eslintWith([PENDING_PROBE])
      assert.isTrue(yield* Effect.promise(() => withPending.isPathIgnored(PENDING_PROBE)))
      assert.isFalse(yield* Effect.promise(() => withPending.isPathIgnored("test/upstream/other.test.ts")))

      const removed = yield* eslintWith([])
      assert.isFalse(yield* Effect.promise(() => removed.isPathIgnored(PENDING_PROBE)))
      const resolved = yield* Effect.promise(() => removed.calculateConfigForFile(PENDING_PROBE))
      assert.isDefined(resolved)

      const projectDefault = new ESLint({ cwd: pkgRoot })
      for (const path of pendingRewrites()) {
        assert.isTrue(yield* Effect.promise(() => projectDefault.isPathIgnored(path)), `${path} is pending`)
      }
      assert.isFalse(yield* Effect.promise(() => projectDefault.isPathIgnored("test/smoke.test.ts")))
    }))

  it.effect("[HARNESS-2] vi.useFakeTimers and node:timers/promises inside test/upstream are lint errors", () =>
    Effect.gen(function* () {
      const eslint = yield* eslintWith([])
      const resolved = yield* Effect.promise(() => eslint.calculateConfigForFile(PENDING_PROBE))
      const syntaxRule = resolved.rules["no-restricted-syntax"]
      const importsRule = resolved.rules["no-restricted-imports"]
      assert.strictEqual(syntaxRule[0], 2)
      assert.strictEqual(importsRule[0], 2)

      const outside = yield* Effect.promise(() => eslint.calculateConfigForFile("test/machine.test.ts"))
      assert.isUndefined(outside.rules["no-restricted-syntax"])
      assert.isUndefined(outside.rules["no-restricted-imports"])

      const linter = new Linter({ cwd: pkgRoot })
      const lint = (code: string) =>
        linter.verify(
          code,
          [{
            files: ["**/*.ts"],
            languageOptions: { parser: tseslint.parser },
            rules: { "no-restricted-syntax": syntaxRule, "no-restricted-imports": importsRule }
          }],
          { filename: PENDING_PROBE }
        ).map((message) => message.ruleId)

      assert.deepStrictEqual(lint(`import { vi } from "vitest"\nvi.useFakeTimers()\n`), ["no-restricted-syntax"])
      assert.deepStrictEqual(lint(`import { setTimeout } from "node:timers/promises"\n`), ["no-restricted-imports"])
      assert.deepStrictEqual(lint(`import { setTimeout as sleep } from "timers/promises"\n`), ["no-restricted-imports"])
      assert.deepStrictEqual(lint(`export const t = import("node:timers/promises")\n`), ["no-restricted-syntax"])
      assert.deepStrictEqual(
        lint(`export const wait = new Promise((resolve) => setTimeout(resolve, 10))\n`),
        ["no-restricted-syntax"]
      )
      assert.deepStrictEqual(
        lint(`import { Effect } from "effect"\nimport { TestClock } from "effect/testing"\nexport const t = Effect.andThen(TestClock.adjust("1 second"), Effect.void)\n`),
        []
      )
    }))

  it.effect("[HARNESS-2] with an empty pending.json lint and tests still run", () =>
    Effect.gen(function* () {
      const pending = pendingRewrites()
      assert.isTrue(Array.isArray(pending))
      for (const path of pending) {
        assert.isTrue(path.startsWith("test/upstream/"), `${path} must live under test/upstream/`)
      }

      const eslint = yield* eslintWith([])
      assert.isFalse(yield* Effect.promise(() => eslint.isPathIgnored("test/smoke.test.ts")))
      assert.isFalse(yield* Effect.promise(() => eslint.isPathIgnored("src/index.ts")))

      const { default: config } = yield* importModule<VitestConfigModule>("vitest.config.ts")
      assert.isAbove(collectedFiles(config.test).length, 0)
    }))

  it.effect("[HARNESS-2] the harness dev dependencies are pinned and resolve", () =>
    Effect.sync(() => {
      const { devDependencies } = packageJson()
      assert.strictEqual(devDependencies["xml-js"], "1.6.11")
      assert.strictEqual(devDependencies["@scion-scxml/test-framework"], "2.0.16")
      assert.strictEqual(devDependencies["rxjs"], "^7.8.1")
      assert.strictEqual(devDependencies["ajv"], "^8.12.0")

      const require = createRequire(import.meta.url)
      for (const specifier of ["@scion-scxml/test-framework/package.json", "xml-js", "rxjs", "ajv"]) {
        assert.isString(require.resolve(specifier))
      }
    }))

  it.effect("[HARNESS-2] the recorded canonical lint bundle hash matches the copied bundle", () =>
    Effect.sync(() => {
      const recorded = readText("test/verify/fixtures/canonical-lint-bundle.sha256").trim()
      const actual = createHash("sha256")
        .update(readFileSync(join(pkgRoot, "eslint-rules/effect-rules.mjs")))
        .digest("hex")
      assert.match(recorded, /^[0-9a-f]{64}$/)
      assert.strictEqual(recorded, actual)
    }))

  it.effect("[HARNESS-2] the upstream clone and delivery folders are gitignored", () =>
    Effect.sync(() => {
      const lines = readText(".gitignore").split("\n").map((line) => line.trim())
      assert.include(lines, ".upstream/")
      assert.include(lines, ".delivery/")
    }))
})
