/**
 * BASELINE-1: the Phase 0 and Phase 1 outcomes still hold.
 *
 * T8.12 (Murat's finding; ACs 2, 3, 19, 21, and AC 41 for the lockfile). Phases 0 and 1 ran
 * before this SPEC (D16, D18): Phase 1 moved the package to `effect@4.0.0` with the
 * `effect-v4-migrate` skill and installed the canonical v4 lint bundle; Phase 0 deleted
 * `todo.md` and added the end-to-end smoke test. Nothing later may undo them, so the finished
 * port is checked again:
 *
 * - AC 2: `package.json` declares `effect` at exactly 4.0.0 in `devDependencies`, with the peer
 *   range `^4.0.0` and no `effect` in `dependencies` (a consumer installs the one copy of the
 *   peer), and `@effect/vitest` at 4.0.0; the installed `effect` is exactly 4.0.0, the package
 *   store holds one copy of it, and `@effect/vitest` is 4.0.0 and resolves that same copy; the
 *   lockfile resolves `effect` and `@effect/vitest` at 4.0.0 only (AC 41);
 * - AC 2: no source file of the package imports a v3-only module. The scan reads every source
 *   file of the package folder (`src`, `test`, `examples`, `scripts`, `eslint-rules` and the
 *   configuration files; not `node_modules` and not the ignored dot folders such as the upstream
 *   clone) and finds every import form in the TypeScript syntax tree. A module is v3-only when
 *   it is one of the packages the user guidance (`~/.agents/guidance/typescript-effect/AGENTS.md`,
 *   "Install and configure v4") says never to add to a v4 repository (`@effect/platform`,
 *   `@effect/rpc`, `@effect/cluster`, `@effect/cli`, `@effect/ai`, `@effect/sql`,
 *   `@effect/workflow`, `@effect/experimental`, `@effect/schema`) or a sub-path of one, or an
 *   `effect` module that the installed `effect` 4.0.0 does not resolve (a v3 module such as
 *   `effect/Either`, or a prerelease path such as `effect/unstable/http`). Each other `@effect/*`
 *   package a file imports (`@effect/vitest` today) is installed at the version of `effect`.
 *   A fixture text proves that the scan finds each form;
 * - AC 19: the SHA-256 of `eslint-rules/effect-rules.mjs` (the path AC 19 names) equals
 *   `test/verify/fixtures/canonical-lint-bundle.sha256`, which T1.1 recorded from the canonical
 *   v4 bundle in the user guidance folder (commit 0439e339 states the digest); the bundle's other
 *   file, `eslint-rules/effect-eslint-config.mjs` (it sets each rule's level), equals the
 *   guidance copy that Phase 1 installed (commit 75631e14). The check reads no home folder, so
 *   it gives the same answer on every machine (T1.1);
 * - AC 21: `todo.md` is absent from the package folder;
 * - AC 3: `test/smoke.test.ts` drives the counter machine of the examples folder through
 *   `createActor`, `send` and `getSnapshot`, the default run collects it, and its test passes.
 *   The file runs the smoke test itself, through the default config with Vitest's node API in
 *   this process, in worker threads (SD-1 bans a child Vitest process; COMPAT-1 runs the
 *   existing test files the same way), and asserts on the smoke test's own result: the run
 *   collects its test, the test passed, no test or suite is skipped, todo, `only` or `fails`,
 *   no file or run error, and the guards of the default config report nothing. A run with
 *   other reporters, or a scenario reporter that accepts a skipped test, cannot hide a skipped
 *   smoke test from that check. The run adds one setup file, `smoke-witness-setup.ts`, which
 *   wraps `createActor` and records what the smoke test does with its actor; the file asserts
 *   that the test made its actor from the examples' counter machine, sent its events, and read
 *   the updated snapshots with the counts that the counter machine gives for them, so a smoke
 *   test that returns before it drives the machine fails here.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { join, matchesGlob } from "node:path"
import { Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { startVitest } from "vitest/node"
import defaultConfig from "../../vitest.config.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))

const readText = (path: string): string => readFileSync(join(pkgRoot, path), "utf8")

const readJson = <A>(path: string): A => JSON.parse(readText(path)) as A

interface PackageJson {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly version?: string
}

/** The packages the user guidance says never to add to a v4 repository: their npm `latest` is v3-era. */
const V3_ONLY_PACKAGES: ReadonlyArray<string> = [
  "@effect/platform",
  "@effect/rpc",
  "@effect/cluster",
  "@effect/cli",
  "@effect/ai",
  "@effect/sql",
  "@effect/workflow",
  "@effect/experimental",
  "@effect/schema",
]

/** The v3-only package a module specifier names (the package or a sub-path of it), if any. */
const v3OnlyPackageOf = (specifier: string): string | undefined =>
  V3_ONLY_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`))

/** True for `effect` and its sub-paths (`effect/Effect`, `effect/testing`, ...). */
const isEffectModule = (specifier: string): boolean => specifier === "effect" || specifier.startsWith("effect/")

/** The `@effect/<name>` package a module specifier names, if any. */
const effectScopePackageOf = (specifier: string): string | undefined =>
  /^@effect\/[^/]+/.exec(specifier)?.[0]

/** Node's module resolution, from the package folder. */
const requireFromPackage = createRequire(join(pkgRoot, "package.json"))

/** The real path of the file a specifier resolves to from the package folder, if it resolves. */
const resolvedFile = (specifier: string): Effect.Effect<Option.Option<string>> =>
  Effect.option(Effect.try(() => realpathSync(requireFromPackage.resolve(specifier))))

/** The package folder that `name` resolves to from `from` (a package folder), through symlinks. */
const packageDir = (from: string, name: string): string => realpathSync(join(from, "node_modules", name))

/** The version in the `package.json` of a package folder. */
const versionOf = (dir: string): string | undefined =>
  (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson).version

/**
 * Why a module specifier names a v3-only module, or nothing when it does not: a v3-only package
 * (or a sub-path of one), or an `effect` module that the installed `effect` (`effectDir`) does
 * not resolve.
 */
const v3OnlyReason = (specifier: string, effectDir: string): Effect.Effect<Option.Option<string>> =>
  Effect.gen(function* () {
    const v3Package = v3OnlyPackageOf(specifier)
    if (v3Package !== undefined) return Option.some(`${v3Package} is a v3-only package`)
    if (!isEffectModule(specifier)) return Option.none()
    const file = yield* resolvedFile(specifier)
    if (Option.isNone(file)) return Option.some("effect 4.0.0 has no such module")
    return file.value.startsWith(`${effectDir}/`) ? Option.none() : Option.some(`resolves outside effect 4.0.0: ${file.value}`)
  })

/**
 * Every module specifier a source text names: `import` and `export ... from` declarations
 * (type-only ones too), `import x = require(...)`, dynamic `import(...)`, `require(...)` and
 * `import("...")` types.
 */
const moduleSpecifiersOf = (fileName: string, text: string): ReadonlyArray<string> => {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: Array<string> = []
  const literal = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) found.push(node.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      literal(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      literal(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        literal(node.arguments[0])
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      literal(node.argument.literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/

/**
 * Every source file of the package folder, relative to it. Left out: `node_modules`, and every
 * entry whose name starts with a dot (the ignored upstream clone `.upstream`, the delivery
 * build `.delivery`, the docs checker's extracted snippets `.markdown-code-check`, `.claude`).
 */
const sourceFiles = (): ReadonlyArray<string> => {
  const walk = (dir: string): ReadonlyArray<string> =>
    readdirSync(dir === "" ? pkgRoot : join(pkgRoot, dir), { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return []
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) return walk(path)
      return entry.isFile() && SOURCE_FILE.test(entry.name) ? [path] : []
    })
  return walk("")
}

/** The SHA-256 of a file of the package, as hex. */
const sha256Of = (path: string): string => createHash("sha256").update(readFileSync(join(pkgRoot, path))).digest("hex")

/** The digest of `eslint-rules/effect-rules.mjs` that T1.1 recorded in the fixture (commit 0439e339). */
const T1_1_RULES_DIGEST = "0283faebe3e3af5f6da0d21592ab6f5dba6ceec8d6dc46212d139f18471ee126"

/** The digest of the canonical `effect-eslint-config.mjs` that Phase 1 copied in (commit 75631e14). */
const CANONICAL_CONFIG_DIGEST = "7bc819abff9a744218d9ac7210ac978e45289ebd8c96a4b95d30e1cbe851c087"

const SMOKE_FILE = "test/smoke.test.ts"

/** The names a source file imports from one module specifier. */
const importedNames = (source: ts.SourceFile, specifier: string): ReadonlyArray<string> =>
  source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    if (statement.moduleSpecifier.text !== specifier) return []
    const bindings = statement.importClause?.namedBindings
    return bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : []
  })

/** The calls in a source file whose callee is the identifier `callee` or a member `.callee`. */
const callsOf = (source: ts.SourceFile, callee: string): ReadonlyArray<ts.CallExpression> => {
  const found: Array<ts.CallExpression> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const name = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : undefined
      if (name === callee) found.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The property names a source file reads with `.name`. */
const propertyReads = (source: ts.SourceFile): ReadonlySet<string> => {
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) found.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The setup file that records what the smoke test does with its actors (the smoke run only). */
const SMOKE_WITNESS_SETUP = join(pkgRoot, "test/verify/smoke-witness-setup.ts")

/** The key of the witness record in the meta of each test (`smoke-witness-setup.ts` writes it). */
const SMOKE_WITNESS_META = "baseline-1.smoke-witness"

/** The status and the count of a snapshot that the smoke test read. */
interface SnapshotRead {
  readonly status: unknown
  readonly count: unknown
}

/** What the actors of one smoke test recorded (`smoke-witness-setup.ts`). */
interface SmokeWitness {
  /** The logic of each actor that `createActor` made: `counterMachine` is the examples' machine. */
  readonly actors: ReadonlyArray<string>
  /** Each event that `send` delivered, in order. */
  readonly sent: ReadonlyArray<unknown>
  /** Each snapshot the test read through `getSnapshot`, in order. */
  readonly getSnapshot: ReadonlyArray<SnapshotRead>
  /** Each snapshot the test read through `changes`, in order. */
  readonly changes: ReadonlyArray<SnapshotRead>
}

/** What one Vitest run of the smoke test file reported. */
interface SmokeRun {
  /** The process exit code the run set: Vitest and the guards of the default config set 1. */
  readonly exitCode: string | number | null | undefined
  /** The output of the run (its reporters), for the failure messages. */
  readonly output: string
  /** The test files the run collected, as paths from the package root. */
  readonly modules: ReadonlyArray<string>
  /** The errors of a file outside its tests (an import or a collection error). */
  readonly moduleErrors: ReadonlyArray<string>
  /** The errors the run reported outside every file, by message. */
  readonly unhandledErrors: ReadonlyArray<string>
  /** Each test the run collected, by full name. */
  readonly tests: ReadonlyArray<string>
  /** Each test that did not pass, as `<full name>: <state>` and the first line of its first error. */
  readonly notPassed: ReadonlyArray<string>
  /** Each test or suite with a mode other than `run` or with `fails`, as `<full name>: <mode>`. */
  readonly notPlain: ReadonlyArray<string>
  /** The witness record of each test, or undefined when the test left none. */
  readonly witnesses: ReadonlyArray<SmokeWitness | undefined>
}

/** The first line of an error message. */
const firstLine = (message: string | undefined): string => (message ?? "").split("\n")[0] ?? ""

/**
 * Runs the smoke test file as `vitest run` does (`startVitest`), with this package's default
 * config (`vitest.config.ts`: its include globs, plugins, setup file and reporters, so the
 * no-skip and pending-rewrite guards too) and the package root, plus the witness setup file.
 * As COMPAT-1 does, the run uses Vitest's node API in this process and worker threads instead
 * of child processes (SD-1), and writes no results cache. The process exit code is cleared
 * before the run and restored after it, so the exit code is read from this run alone and never
 * reaches the run of this file.
 */
const runSmokeTest = Effect.acquireUseRelease(
  Effect.sync(() => {
    const saved = process.exitCode
    process.exitCode = undefined
    return saved
  }),
  () =>
    Effect.promise(async (): Promise<SmokeRun> => {
      const output: Array<string> = []
      const sink = new Writable({
        write(chunk: unknown, _encoding, done) {
          output.push(String(chunk))
          done()
        }
      })
      const vitest = await startVitest(
        [SMOKE_FILE],
        {
          config: join(pkgRoot, "vitest.config.ts"),
          root: pkgRoot,
          run: true,
          watch: false,
          pool: "threads",
          maxWorkers: 1,
          cache: false,
          setupFiles: [...(defaultConfig.test?.setupFiles ?? []), SMOKE_WITNESS_SETUP]
        },
        {},
        { stdout: sink, stderr: sink }
      )
      const testModules = vitest.state.getTestModules()
      const tests = testModules.flatMap((testModule) => [...testModule.children.allTests()])
      const suites = testModules.flatMap((testModule) => [...testModule.children.allSuites()])
      return {
        exitCode: process.exitCode,
        output: output.join(""),
        modules: testModules.map((testModule) => testModule.relativeModuleId),
        moduleErrors: testModules.flatMap((testModule) =>
          testModule.errors().map((error) => `${testModule.relativeModuleId}: ${firstLine(error.message)}`)
        ),
        unhandledErrors: vitest.state.getUnhandledErrors().map((error) => firstLine(String(error))),
        tests: tests.map((test) => test.fullName),
        notPassed: tests.flatMap((test) => {
          const result = test.result()
          return result.state === "passed"
            ? []
            : [`${test.fullName}: ${result.state} ${firstLine(result.errors?.[0]?.message)}`.trim()]
        }),
        notPlain: [...tests, ...suites].flatMap((task) =>
          task.options.mode === "run" && task.options.fails !== true
            ? []
            : [`${task.fullName}: ${task.options.fails === true ? "fails" : task.options.mode}`]
        ),
        witnesses: tests.map((test) => (test.meta() as Readonly<Record<string, unknown>>)[SMOKE_WITNESS_META] as SmokeWitness | undefined)
      }
    }),
  (saved) =>
    Effect.sync(() => {
      process.exitCode = saved
    })
)

describe("BASELINE-1 The Phase 0 and Phase 1 outcomes still hold", () => {
  it.effect("[BASELINE-1] package.json declares effect 4.0.0 as a dev dependency with the peer range ^4.0.0 and not as a dependency, @effect/vitest at 4.0.0, and no v3-only package", () =>
    Effect.sync(() => {
      const manifest = readJson<PackageJson>("package.json")
      assert.strictEqual(manifest.devDependencies?.["effect"], "4.0.0")
      assert.strictEqual(manifest.peerDependencies?.["effect"], "^4.0.0")
      assert.isFalse(Object.hasOwn(manifest.dependencies ?? {}, "effect"), "effect is a peer, not a dependency")
      assert.match(manifest.devDependencies?.["@effect/vitest"] ?? "", /^\^?4\.0\.0$/)
      const declared = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]
      assert.deepStrictEqual(declared.filter((name) => v3OnlyPackageOf(name) !== undefined), [], "no v3-only package is declared")
    }))

  it.effect("[BASELINE-1] the installed effect is exactly 4.0.0, the store holds one copy, and @effect/vitest is 4.0.0 and resolves that copy", () =>
    Effect.gen(function* () {
      const effectDir = packageDir(pkgRoot, "effect")
      const vitestDir = packageDir(pkgRoot, "@effect/vitest")
      assert.strictEqual(versionOf(effectDir), "4.0.0")
      assert.strictEqual(versionOf(vitestDir), "4.0.0")

      // Node's resolution of `effect` from the package lands in that folder
      const resolved = yield* resolvedFile("effect")
      assert.isTrue(Option.isSome(resolved) && resolved.value.startsWith(`${effectDir}/`), "effect resolves to the 4.0.0 folder")

      // pnpm keeps one folder per resolved version in its store: one is effect's, one @effect/vitest's
      const store = readdirSync(join(pkgRoot, "node_modules", ".pnpm"))
      assert.deepStrictEqual(store.filter((entry) => entry.startsWith("effect@")), ["effect@4.0.0"])
      const vitestEntries = store.filter((entry) => entry.startsWith("@effect+vitest@"))
      assert.strictEqual(vitestEntries.length, 1)
      assert.match(vitestEntries[0] ?? "", /^@effect\+vitest@4\.0\.0_effect@4\.0\.0_/)
      // @effect/vitest's own `effect` (its peer, beside it in its store folder) is the package's
      assert.strictEqual(realpathSync(join(vitestDir, "..", "..", "effect")), effectDir)
    }))

  it.effect("[BASELINE-1] the lockfile resolves effect and @effect/vitest at 4.0.0 only", () =>
    Effect.sync(() => {
      const lock = readText("pnpm-lock.yaml")
      const versionsOf = (name: string): ReadonlyArray<string> => {
        const quoted = name.startsWith("@") ? `'${name}` : name
        const keys = lock
          .split("\n")
          .filter((line) => line.startsWith(`  ${quoted}@`))
          .map((line) => /@(\d+\.\d+\.\d+[^:'(]*)/.exec(line.slice(2 + quoted.length))?.[1] ?? line)
        return [...new Set(keys)]
      }
      assert.deepStrictEqual(versionsOf("effect"), ["4.0.0"])
      assert.deepStrictEqual(versionsOf("@effect/vitest"), ["4.0.0"])
    }))

  it.effect("[BASELINE-1] the v3-only import scan finds a fixture source's v3-only modules in each import form, and passes the v4 modules", () =>
    Effect.gen(function* () {
      const effectDir = packageDir(pkgRoot, "effect")
      const fixture = [
        `import { Schema } from "@effect/schema"`,
        `import * as Http from "@effect/platform/HttpClient"`,
        `export { Rpc } from "@effect/rpc"`,
        `export * from "@effect/experimental"`,
        `import type { Workflow } from "@effect/workflow/Workflow"`,
        `import Cluster = require("@effect/cluster")`,
        `const sql = await import("@effect/sql")`,
        `type Cli = typeof import("@effect/cli")`,
        `const ai = require("@effect/ai")`,
        `import { Either } from "effect/Either"`,
        `import * as TestClock from "effect/TestClock"`,
        `import { HttpClient } from "effect/unstable/http"`,
        `import { Effect } from "effect"`,
        `import { Option } from "effect/Option"`,
        `import { TestClock as Clock } from "effect/testing"`,
        `import { NodeServices } from "@effect/platform-node"`,
        `import { it } from "@effect/vitest"`,
        `const text = "@effect/schema in a string is not an import"`,
      ].join("\n")
      const named = moduleSpecifiersOf("fixture.ts", fixture)
      const flagged: Array<string> = []
      for (const specifier of named) {
        if (Option.isSome(yield* v3OnlyReason(specifier, effectDir))) flagged.push(specifier)
      }
      assert.deepStrictEqual(flagged, [
        "@effect/schema",
        "@effect/platform/HttpClient",
        "@effect/rpc",
        "@effect/experimental",
        "@effect/workflow/Workflow",
        "@effect/cluster",
        "@effect/sql",
        "@effect/cli",
        "@effect/ai",
        "effect/Either",
        "effect/TestClock",
        "effect/unstable/http",
      ])
      assert.deepStrictEqual(
        named.filter((specifier) => !flagged.includes(specifier)),
        ["effect", "effect/Option", "effect/testing", "@effect/platform-node", "@effect/vitest"]
      )
      assert.isUndefined(v3OnlyPackageOf("@effect/sql-pg"))
      assert.isUndefined(v3OnlyPackageOf("@effect/ai-openai"))
    }))

  it.effect("[BASELINE-1] no source file of the package imports a v3-only module, and each @effect package it imports is at the version of effect", () =>
    Effect.gen(function* () {
      const effectDir = packageDir(pkgRoot, "effect")
      const files = sourceFiles()
      for (const folder of ["src/", "test/", "test/verify/", "test/upstream/", "examples/", "scripts/", "eslint-rules/"]) {
        assert.isTrue(files.some((file) => file.startsWith(folder)), `the scan reads ${folder}`)
      }
      assert.include(files, "vitest.config.ts")
      assert.include(files, "eslint.config.mjs")
      assert.isFalse(files.some((file) => file.split("/").some((part) => part === "node_modules" || part.startsWith("."))))

      const offenders: Array<string> = []
      const scopePackages = new Set<string>()
      for (const file of files) {
        for (const specifier of moduleSpecifiersOf(file, readText(file))) {
          const reason = yield* v3OnlyReason(specifier, effectDir)
          if (Option.isSome(reason)) offenders.push(`${file}: ${specifier} (${reason.value})`)
          const scopePackage = effectScopePackageOf(specifier)
          if (scopePackage !== undefined) scopePackages.add(scopePackage)
        }
      }
      assert.deepStrictEqual(offenders, [])

      // `@effect/vitest` is the one scoped package the files import today
      assert.include([...scopePackages], "@effect/vitest")
      for (const name of scopePackages) {
        const installed = existsSync(join(pkgRoot, "node_modules", name)) ? versionOf(packageDir(pkgRoot, name)) : undefined
        assert.strictEqual(installed, versionOf(effectDir), `${name} is installed at the version of effect`)
      }
    }))

  it.effect("[BASELINE-1] the lint bundle equals the canonical v4 bundle: eslint-rules/effect-rules.mjs has the SHA-256 that T1.1 recorded, and effect-eslint-config.mjs is the copy Phase 1 installed", () =>
    Effect.sync(() => {
      const recorded = readText("test/verify/fixtures/canonical-lint-bundle.sha256").trim()
      assert.strictEqual(recorded, T1_1_RULES_DIGEST, "the fixture holds the digest T1.1 recorded")
      assert.strictEqual(sha256Of("eslint-rules/effect-rules.mjs"), recorded)
      assert.strictEqual(sha256Of("eslint-rules/effect-eslint-config.mjs"), CANONICAL_CONFIG_DIGEST)
    }))

  it.effect("[BASELINE-1] todo.md is absent from the package folder (D18)", () =>
    Effect.sync(() => {
      assert.isFalse(existsSync(join(pkgRoot, "todo.md")))
      assert.notInclude(readdirSync(pkgRoot).map((name) => name.toLowerCase()), "todo.md")
    }))

  it.effect("[BASELINE-1] the Phase 0 smoke test is in the default run and drives the counter machine of the examples folder through createActor, send and getSnapshot", () =>
    Effect.sync(() => {
      const include = defaultConfig.test?.include ?? []
      const exclude = defaultConfig.test?.exclude ?? []
      assert.isTrue(include.some((glob) => matchesGlob(SMOKE_FILE, glob)), "the default include takes the smoke file")
      assert.isFalse(exclude.some((glob) => matchesGlob(SMOKE_FILE, glob)), "the default exclude leaves it")

      const source = ts.createSourceFile(SMOKE_FILE, readText(SMOKE_FILE), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      assert.include(importedNames(source, "../examples/counter.js"), "counterMachine")
      assert.include(importedNames(source, "../src/index.js"), "createActor")
      assert.isTrue(
        callsOf(source, "createActor").some((call) => {
          const first = call.arguments[0]
          return first !== undefined && ts.isIdentifier(first) && first.text === "counterMachine"
        }),
        "the smoke test calls createActor(counterMachine)"
      )
      assert.isAtLeast(callsOf(source, "send").length, 2, "the smoke test sends events")
      assert.isTrue(propertyReads(source).has("getSnapshot"), "the smoke test reads the snapshot")
      assert.isAtLeast(callsOf(source, "effect").length, 1, "the smoke file holds a test")
    }))

  it.effect("[BASELINE-1] the Phase 0 smoke test passes: a run of test/smoke.test.ts through the default config passes its test, skips none, and the test makes its actor from the counter machine with createActor, sends events and reads the updated snapshots", () =>
    Effect.gen(function* () {
      const run = yield* runSmokeTest
      assert.deepStrictEqual(run.modules, [SMOKE_FILE], `the run collects the smoke file\n${run.output}`)
      assert.deepStrictEqual(run.moduleErrors, [], "the smoke file fails nowhere outside its test")
      assert.deepStrictEqual(run.unhandledErrors, [], "the run reports no unhandled error")
      assert.strictEqual(run.tests.length, 1, `the smoke file holds one test: ${run.tests.join(", ")}`)
      assert.deepStrictEqual(run.notPassed, [], "the smoke test passes")
      assert.deepStrictEqual(run.notPlain, [], "no smoke test or suite is skipped, todo, only or fails")
      assert.include([undefined, 0], run.exitCode, `the run exits 0 and the guards of the default config report nothing\n${run.output}`)

      // What the test did with its actor (the witness setup file recorded it)
      const [witness] = run.witnesses
      assert.isDefined(witness, "the smoke test left a witness record")
      assert.deepStrictEqual(witness?.actors, ["counterMachine"], "createActor made one actor, from the counter machine of the examples folder")
      assert.deepStrictEqual(
        witness?.sent,
        [{ type: "increment" }, { type: "increment" }, { type: "decrement" }, { type: "set", value: 42 }, { type: "reset" }],
        "the test sent its events to the actor"
      )
      assert.deepStrictEqual(
        witness?.changes,
        [0, 1, 2, 1, 42, 0].map((count) => ({ status: "active", count })),
        "the test read each updated snapshot through changes, with the count the counter machine gives"
      )
      assert.deepStrictEqual(
        witness?.getSnapshot,
        [{ status: "active", count: 0 }, { status: "stopped", count: 0 }],
        "the test read the snapshot through getSnapshot after its events and after the stop"
      )
    }), 60_000)
})
