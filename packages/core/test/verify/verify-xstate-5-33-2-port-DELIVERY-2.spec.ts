/**
 * DELIVERY-2: each entry point loads alone.
 *
 * T7.14 (D10). A module that reads a binding of a module still running above it in an import
 * cycle fails with a `ReferenceError` ("Cannot access … before initialization"). Which module
 * runs first depends on the entry point a consumer imports, so an import cycle can break one
 * entry point while the others load. The file builds the package once into a folder of this
 * run (`delivery.ts`) and imports each of the six entry points alone, by package name, in a
 * fresh Node process that also reads every export. A two-module cycle written beside the
 * build shows that the same check reports such an error.
 */
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  BUILD_TIMEOUT_MS,
  type Build,
  buildPackage,
  ENTRY_POINTS,
  loadAlone,
  readPackageJson,
  removeBuild,
  specifierOf
} from "./delivery.js"

// ---------------------------------------------------------------- the build

let build: Build | undefined

beforeAll(() => {
  build = buildPackage("DELIVERY-2")
}, BUILD_TIMEOUT_MS)

afterAll(() => {
  removeBuild(build)
})

/** The build of this run; a test that runs before `beforeAll` built it fails. */
const theBuild = Effect.sync((): Build => {
  assert.isDefined(build, "beforeAll built the package")
  return build as Build
})

// ---------------------------------------------------------------- tests

describe("DELIVERY-2 each entry point loads alone", () => {
  it.effect("[DELIVERY-2] the package builds into a folder made by this run and exports the six entry points", () =>
    Effect.gen(function* () {
      const { folder, result } = yield* theBuild
      assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`)
      const exportsField = readPackageJson(folder).exports
      for (const entry of ENTRY_POINTS) assert.isTrue(Object.hasOwn(exportsField, entry), `${entry} is exported`)
    }))

  for (const entry of ENTRY_POINTS) {
    it.effect(`[DELIVERY-2] ${specifierOf(entry)} imported alone in a fresh Node process loads without an initialisation-order error`, () =>
      Effect.gen(function* () {
        const { folder } = yield* theBuild
        const result = loadAlone(folder, specifierOf(entry))
        assert.notInclude(result.stderr, "before initialization")
        assert.notInclude(result.stderr, "ReferenceError")
        assert.strictEqual(result.status, 0, result.stderr)
        const names = JSON.parse(result.stdout) as ReadonlyArray<string>
        assert.isAbove(names.length, 0, `${specifierOf(entry)} has exports`)
      }), BUILD_TIMEOUT_MS)
  }

  it.effect("[DELIVERY-2] the same check reports the initialisation-order error of an import cycle", () =>
    Effect.gen(function* () {
      const { folder } = yield* theBuild
      const cycle = join(folder, "cycle")
      mkdirSync(cycle)
      writeFileSync(
        join(cycle, "package.json"),
        JSON.stringify({ name: "cycle-fixture", type: "module", exports: { ".": "./entry.js" } })
      )
      writeFileSync(join(cycle, "entry.js"), `import { helper } from "./helper.js"\nexport const base = 1\nexport { helper }\n`)
      writeFileSync(join(cycle, "helper.js"), `import { base } from "./entry.js"\nexport const helper = base + 1\n`)
      const result = loadAlone(cycle, "cycle-fixture")
      assert.notStrictEqual(result.status, 0)
      assert.include(result.stderr, "ReferenceError")
      assert.include(result.stderr, "before initialization")
    }), BUILD_TIMEOUT_MS)
})
