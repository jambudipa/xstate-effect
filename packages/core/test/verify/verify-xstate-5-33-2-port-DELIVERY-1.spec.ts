/**
 * DELIVERY-1: every entry point resolves from the built package.
 *
 * T7.14 (D10). xstate@5.33.2 exports six entry points: `.`, `./actions`, `./actors`,
 * `./dev`, `./graph` and `./guards` (and `./package.json`). The port's `package.json`
 * exports the same subpaths, each with `types`, `import` and `default` conditions that point at
 * `dist/<name>/index.d.ts` and, twice, `dist/<name>/index.js` (`dist/index.*` for the root). The
 * port is ESM only, as `effect` 4 is: a `require` resolves through `default` to the ES module
 * file. Upstream also ships CommonJS (`default`), with `module` and `development`; DEV-54.
 *
 * The file builds the package once into a folder of this run (`delivery.ts`). A consumer
 * module inside it imports each entry point by package name, Node at run time and the
 * TypeScript compiler under NodeNext module resolution; each entry point then holds every
 * value name of the upstream entry point of the same name (the manifest's export lists),
 * unless a deviation row records that the port does not export it (the absence rule of
 * EXP-1). The built files import no package but `effect`, call no `eval`, and hold no SCXML
 * converter.
 */
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"
import {
  BUILD_TIMEOUT_MS,
  type Build,
  buildPackage,
  ENTRY_POINTS,
  PKG_ROOT,
  readPackageJson,
  removeBuild,
  runCommonJs,
  runModule,
  runTsc,
  specifierOf
} from "./delivery.js"
import { LEDGER_FILE, type LedgerRow, parseLedger } from "./ledger.js"

// ---------------------------------------------------------------- the build

let build: Build | undefined

beforeAll(() => {
  build = buildPackage("DELIVERY-1")
}, BUILD_TIMEOUT_MS)

afterAll(() => {
  removeBuild(build)
})

/** The build of this run; a test that runs before `beforeAll` built it fails. */
const theBuild = Effect.sync((): Build => {
  assert.isDefined(build, "beforeAll built the package")
  return build as Build
})

// ---------------------------------------------------------------- upstream and the ledger

interface ManifestExport {
  readonly entry: string
  readonly types: ReadonlyArray<string>
  readonly values: ReadonlyArray<string>
}

/** The six upstream export lists of the frozen manifest, by subpath. */
const upstreamExports = (): Readonly<Record<string, ManifestExport>> =>
  (JSON.parse(readFileSync(join(PKG_ROOT, "test/upstream/upstream-manifest.json"), "utf8")) as {
    readonly exports: Readonly<Record<string, ManifestExport>>
  }).exports

/** The names a deviation row's `Subject` holds in backticks. */
const subjectNames = (row: LedgerRow): ReadonlyArray<string> =>
  [...(row["Subject"] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "")

/**
 * True when a deviation row records that the port does not export `name`: its `Subject`
 * names it in backticks and its `Port` cell starts `Not exported` or `Not ported`, or says
 * ``No `<name>` `` (the absence rule of EXP-1). A row about how an exported name behaves
 * excuses nothing.
 */
const isLedgeredAbsent = (deviations: ReadonlyArray<LedgerRow>, name: string): boolean =>
  deviations.some((row) => {
    const port = row["Port"] ?? ""
    return subjectNames(row).includes(name) &&
      (/^Not (exported|ported)\b/.test(port) || port.includes(`No \`${name}\``))
  })

// ---------------------------------------------------------------- the built files

/** Every file under `folder`, relative to it, with `/` separators. */
const filesUnder = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort()

/** The package a bare module specifier names: `effect/Cause` → `effect`, `@a/b/c` → `@a/b`. */
const packageOf = (specifier: string): string => {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
}

/** The module specifiers a built file imports (static, dynamic, `export from`, `import()` types). */
const importsOf = (text: string): ReadonlyArray<string> =>
  ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName)

/** The global objects a built file could reach `eval` or `Function` through. */
const GLOBALS = new Set(["globalThis", "window", "self", "global"])

/**
 * The calls of `eval` and of the `Function` constructor in a built file, with their line:
 * `eval(…)`, `new Function(…)`, `Function(…)`, and the same through a global object.
 */
const evalSitesOf = (file: string, text: string): ReadonlyArray<string> => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, false)
  const sites: Array<string> = []
  const nameOf = (callee: ts.Expression): string | null =>
    ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && GLOBALS.has(callee.expression.text)
      ? callee.name.text
      : null
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = nameOf(node.expression)
      if (name === "eval" || name === "Function") {
        sites.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

// ---------------------------------------------------------------- tests

describe("DELIVERY-1 every entry point resolves from the built package", () => {
  it.effect("[DELIVERY-1] the package builds into a folder made by this run, with its package.json beside dist", () =>
    Effect.gen(function* () {
      const { args, folder, result, startedAt } = yield* theBuild
      assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`)
      assert.deepStrictEqual(args.slice(0, 2), ["-p", "tsconfig.build.json"])
      assert.isTrue(relative(join(PKG_ROOT, ".delivery", "DELIVERY-1"), folder).startsWith("run-"))
      // The NodeNext test writes its consumer module beside them, in any test order
      assert.includeMembers(readdirSync(folder), ["dist", "package.json"])
      assert.strictEqual(
        readFileSync(join(folder, "package.json"), "utf8"),
        readFileSync(join(PKG_ROOT, "package.json"), "utf8")
      )
      const written = filesUnder(join(folder, "dist"))
      assert.include(written, "index.js")
      for (const file of written) {
        const second = Math.floor(statSync(join(folder, "dist", file)).mtimeMs / 1000)
        assert.isAtLeast(second, Math.floor(startedAt / 1000), `${file} was written by this run`)
      }
    }))

  it.effect("[DELIVERY-1] the manifest exports the root and the five upstream subpaths, each with its types file and its import and default file in dist", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const exportsField = readPackageJson(folder).exports
      assert.deepStrictEqual(
        Object.keys(exportsField).sort(),
        [...Object.keys(upstreamExports()), "./package.json"].sort()
      )
      assert.deepStrictEqual([...ENTRY_POINTS].sort(), Object.keys(upstreamExports()).sort())
      assert.strictEqual(exportsField["./package.json"], "./package.json")
      for (const entry of ENTRY_POINTS) {
        const base = entry === "." ? "./dist/index" : `./dist/${entry.slice(2)}/index`
        assert.deepStrictEqual(exportsField[entry], { types: `${base}.d.ts`, import: `${base}.js`, default: `${base}.js` }, entry)
        assert.deepStrictEqual(Object.keys(exportsField[entry] ?? {}), ["types", "import", "default"], `${entry} condition order`)
        assert.isTrue(existsSync(join(folder, `${base}.d.ts`)), `${entry}: ${base}.d.ts is built`)
        assert.isTrue(existsSync(join(folder, `${base}.js`)), `${entry}: ${base}.js is built`)
      }
    }))

  it.effect("[DELIVERY-1] a consumer module imports the root, actions, actors, guards, graph and dev entry points by package name", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const source = [
        `const specifiers = ${JSON.stringify(ENTRY_POINTS.map(specifierOf))}`,
        "const names = {}",
        "for (const specifier of specifiers) names[specifier] = Object.keys(await import(specifier))",
        "process.stdout.write(JSON.stringify(names))"
      ].join("\n")
      const result = runModule(folder, source)
      assert.strictEqual(result.status, 0, result.stderr)
      const names = JSON.parse(result.stdout) as Readonly<Record<string, ReadonlyArray<string>>>
      assert.deepStrictEqual(Object.keys(names), ENTRY_POINTS.map(specifierOf))
      for (const specifier of Object.keys(names)) {
        assert.isAbove(names[specifier]?.length ?? 0, 0, `${specifier} has exports`)
      }
    }), BUILD_TIMEOUT_MS)

  it.effect("[DELIVERY-1] each import resolves under NodeNext module resolution, and an undeclared subpath does not", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const consumer = [
        `import * as Root from "${specifierOf(".")}"`,
        `import * as Actions from "${specifierOf("./actions")}"`,
        `import * as Actors from "${specifierOf("./actors")}"`,
        `import * as Guards from "${specifierOf("./guards")}"`,
        `import * as Graph from "${specifierOf("./graph")}"`,
        `import * as Dev from "${specifierOf("./dev")}"`,
        "// @ts-expect-error the package exports no ./internal subpath",
        `import * as Internal from "${specifierOf("./internal/globalObject")}"`,
        "export const machine: typeof Root.createMachine = Root.createMachine",
        "export const assign: typeof Actions.assign = Actions.assign",
        "export const fromPromise: typeof Actors.fromPromise = Actors.fromPromise",
        "export const and: typeof Guards.and = Guards.and",
        "export const getShortestPaths: typeof Graph.getShortestPaths = Graph.getShortestPaths",
        "export const getGlobal: typeof Dev.getGlobal = Dev.getGlobal",
        "export const internal: unknown = Internal",
        ""
      ].join("\n")
      writeFileSync(join(folder, "consumer.ts"), consumer)
      const result = runTsc(folder, [
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "--lib",
        "es2022,dom",
        "consumer.ts"
      ])
      assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`)
    }), BUILD_TIMEOUT_MS)

  it.effect("[DELIVERY-1] each entry point exposes the value names of the upstream entry point of the same name, or a deviation row records the absence", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const upstream = upstreamExports()
      const specifiers = Object.fromEntries(ENTRY_POINTS.map((entry) => [entry, specifierOf(entry)]))
      const source = [
        `const specifiers = ${JSON.stringify(specifiers)}`,
        "const names = {}",
        "for (const [entry, specifier] of Object.entries(specifiers)) names[entry] = Object.keys(await import(specifier))",
        "process.stdout.write(JSON.stringify(names))"
      ].join("\n")
      const result = runModule(folder, source)
      assert.strictEqual(result.status, 0, result.stderr)
      const port = JSON.parse(result.stdout) as Readonly<Record<string, ReadonlyArray<string>>>
      const parsed = parseLedger(readFileSync(join(PKG_ROOT, LEDGER_FILE), "utf8"))
      assert.deepStrictEqual(parsed.problems, [])
      const missing = ENTRY_POINTS.flatMap((entry) =>
        (upstream[entry]?.values ?? [])
          .filter((name) => !(port[entry] ?? []).includes(name))
          .filter((name) => !isLedgeredAbsent(parsed.ledger.deviations, name))
          .map((name) => `${entry} ${name}`)
      )
      assert.deepStrictEqual(missing, [])
      for (const entry of ENTRY_POINTS) {
        assert.isAbove(upstream[entry]?.values.length ?? 0, 0, `the manifest lists the values of ${entry}`)
      }
    }), BUILD_TIMEOUT_MS)

  it.effect("[DELIVERY-1] an import of an undeclared subpath fails resolution", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      for (const subpath of ["dist/index.js", "internal/globalObject", "graph/utils", "src/index.ts"]) {
        const specifier = `${specifierOf(".")}/${subpath}`
        const result = runModule(folder, `await import(${JSON.stringify(specifier)})`)
        assert.notStrictEqual(result.status, 0, specifier)
        assert.include(result.stderr, "ERR_PACKAGE_PATH_NOT_EXPORTED", specifier)
      }
    }), BUILD_TIMEOUT_MS)

  it.effect("[DELIVERY-1] a require of an entry point resolves through the default condition to the ES module file of its import, as the package is ESM only (DEV-54), and its package.json resolves", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const source = [
        `const specifiers = ${JSON.stringify(ENTRY_POINTS.map(specifierOf))}`,
        "const resolved = specifiers.map((specifier) => {",
        "  try { return require.resolve(specifier) } catch (error) { return error.code }",
        "})",
        `const manifest = require(${JSON.stringify(`${specifierOf(".")}/package.json`)})`,
        "process.stdout.write(JSON.stringify({ resolved, name: manifest.name, type: manifest.type }))"
      ].join("\n")
      const result = runCommonJs(folder, source)
      assert.strictEqual(result.status, 0, result.stderr)
      const { name, resolved, type } = JSON.parse(result.stdout) as {
        readonly resolved: ReadonlyArray<string>
        readonly name: string
        readonly type: string
      }
      assert.deepStrictEqual(
        resolved,
        ENTRY_POINTS.map((entry) => join(folder, entry === "." ? "dist/index.js" : `dist/${entry.slice(2)}/index.js`))
      )
      // One build: the file a require resolves is the ES module file an import loads
      assert.strictEqual(type, "module")
      assert.strictEqual(name, specifierOf("."))
    }), BUILD_TIMEOUT_MS)

  it.effect("[DELIVERY-1] the built package contains no SCXML converter, no eval, and no test-only dependency", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const dist = join(folder, "dist")
      const files = filesUnder(dist)
      const code = files.filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"))
      assert.isAbove(code.length, 0)
      assert.deepStrictEqual(files.filter((file) => /scxml/i.test(file)), [])

      const manifest = readPackageJson(folder)
      const runtime = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
      const testOnly = Object.keys(manifest.devDependencies ?? {}).filter((name) => !runtime.has(name))
      assert.include(testOnly, "@scion-scxml/test-framework")
      assert.include(testOnly, "xml-js")

      const packages = new Set<string>()
      const outside: Array<string> = []
      const evalSites: Array<string> = []
      for (const file of code) {
        const text = readFileSync(join(dist, file), "utf8")
        for (const specifier of importsOf(text)) {
          if (specifier.startsWith(".")) {
            const target = resolve(dirname(join(dist, file)), specifier)
            const built = file.endsWith(".d.ts") ? target.replace(/\.js$/, ".d.ts") : target
            if (!built.startsWith(`${dist}/`) || !existsSync(built)) outside.push(`${file} -> ${specifier}`)
          } else if (!specifier.startsWith("node:")) {
            packages.add(packageOf(specifier))
          }
        }
        evalSites.push(...evalSitesOf(file, text))
      }
      assert.deepStrictEqual([...packages].sort(), ["effect"])
      assert.deepStrictEqual([...packages].filter((name) => testOnly.includes(name)), [])
      assert.isTrue(Object.hasOwn(manifest.peerDependencies ?? {}, "effect"))
      assert.deepStrictEqual(outside, [])
      assert.deepStrictEqual(evalSites, [])
    }))
})
