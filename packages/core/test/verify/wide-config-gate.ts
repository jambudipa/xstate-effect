/**
 * Compile-time settlement fixtures, checked without filtering compiler diagnostics.
 *
 * @since 0.4.0
 */
import { assert } from "@effect/vitest"
import { readFileSync, readdirSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import ts from "typescript"

/** The complete expected diagnostic list for each separately named fixture. */
const Manifest = Schema.Array(Schema.Struct({
  file: Schema.String,
  diagnostics: Schema.Array(Schema.Struct({
    code: Schema.Number,
    line: Schema.Number,
    message: Schema.String
  }))
}))

/** The package root supplies source imports and installed compiler dependencies. */
const packageRoot = fileURLToPath(new URL("../../", import.meta.url))

/** The fixture directory stores source text without exposing negative cases to tsc. */
const fixtureRoot = join(packageRoot, "test/fixtures/wide-config-gate")

/**
 * Compile every fixture together and require exactly its declared diagnostics.
 * Errors in imported sources, support files, compiler options, and libraries also fail.
 *
 * @since 0.4.0
 */
export const checkWideConfigGate = (): void => {
  /** The manifest receives runtime validation before it controls expectations. */
  const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(fixtureRoot, "manifest.json"), "utf8")))
  /** The virtual files retain their real directory for ordinary relative imports. */
  const virtual = new Map(readdirSync(fixtureRoot).filter((file) => file.endsWith(".ts.txt")).map((file) => [
    join(fixtureRoot, file.slice(0, -4)), readFileSync(join(fixtureRoot, file), "utf8")
  ]))
  /** The options match the reproduction and explicitly load the Node globals. */
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    noErrorTruncation: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["node"],
    typeRoots: [join(packageRoot, "node_modules/@types")]
  }
  /** The ordinary compiler host reads dependencies; these overrides add fixture text. */
  const host = ts.createCompilerHost(options)
  /** The original host readers preserve ordinary dependency resolution. */
  const read = host.readFile
  /** The original existence check preserves ordinary dependency resolution. */
  const exists = host.fileExists
  host.readFile = (file) => virtual.get(resolve(file)) ?? read(file)
  host.fileExists = (file) => virtual.has(resolve(file)) || exists(file)
  /** One program shares dependency checking across the complete acceptance matrix. */
  const program = ts.createProgram([...virtual.keys()], options, host)
  /** Every pre-emit diagnostic participates in an assertion, including global errors. */
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file?.fileName ?? "<compiler>",
    line: diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
      : 0,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  }))
  /** The named fixtures are the only files permitted to produce expected errors. */
  const expectedFiles = new Set(manifest.map((fixture) => join(fixtureRoot, fixture.file)))
  assert.strictEqual(expectedFiles.size, manifest.length, "each fixture needs exactly one manifest entry")
  assert.deepStrictEqual([...expectedFiles].sort(), [...virtual.keys()].filter((file) => basename(file) !== "support.ts").sort(), "every fixture needs declared expectations")
  assert.deepStrictEqual(diagnostics.filter((diagnostic) => !expectedFiles.has(diagnostic.file)), [], "unexpected compiler diagnostics")
  for (const fixture of manifest) {
    /** The exact diagnostics for this fixture, in the compiler's stable source order. */
    const actual = diagnostics.filter((diagnostic) => diagnostic.file === join(fixtureRoot, fixture.file))
    assert.strictEqual(actual.length, fixture.diagnostics.length, `${fixture.file}: ${JSON.stringify(actual)}`)
    fixture.diagnostics.forEach((expected, index) => {
      /** The length assertion above guarantees that the corresponding diagnostic exists. */
      const diagnostic = actual[index]!
      assert.strictEqual(diagnostic.code, expected.code, `${fixture.file}: diagnostic code`)
      assert.strictEqual(diagnostic.line, expected.line, `${fixture.file}: diagnostic line`)
      assert.ok(diagnostic.message.includes(expected.message), `${fixture.file}: ${diagnostic.message}`)
      if (basename(fixture.file).includes("-B")) {
        assert.ok(!diagnostic.message.includes("ConfigNotLiteral"), `${fixture.file}: the literal needs its real diagnostic`)
      }
    })
  }
}
