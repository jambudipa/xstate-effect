/**
 * Verify the settlement acceptance fixtures with TypeScript and the native compiler.
 * This CLI can spawn a compiler; no test imports it.
 *
 * @since 0.4.0
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import ts from "typescript";

/** The package containing the committed fixtures and this compiler dependency. */
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
/** The committed inputs used by the COV-1 regression. */
const fixtureRoot = join(packageRoot, "test/fixtures/wide-config-gate");
/** Validate the expected diagnostics before using them as an acceptance oracle. */
const Manifest = Schema.Array(Schema.Struct({
  file: Schema.String,
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.Number, line: Schema.Number, message: Schema.String }))
}));

/** Read CLI options without invoking a shell or changing source files. */
function optionsOf(args) {
  /** The native compiler stays external; this tool installs no dependencies. */
  const options = { tsgo: "tsgo", sourceRoot: packageRoot, report: undefined, keepTemp: false };
  for (let index = 0; index < args.length; index += 1) {
    /** The current flag selects one documented option. */
    const flag = args[index];
    if (flag === "--keep-temp") {
      options.keepTemp = true;
      continue;
    }
    assert.ok(["--tsgo", "--source-root", "--report"].includes(flag), `Unknown option: ${flag}`);
    /** Each remaining flag requires a separate nonempty argument. */
    const value = args[++index];
    assert.ok(value && !value.startsWith("--"), `${flag} needs a value`);
    if (flag === "--tsgo") options.tsgo = value.includes("/") ? resolve(value) : value;
    if (flag === "--source-root") options.sourceRoot = resolve(value);
    if (flag === "--report") options.report = resolve(value);
  }
  return options;
}

/** Run the native compiler directly and preserve both output streams. */
function runNative(executable, args, cwd) {
  /** Negative fixtures normally make the compiler exit with status one. */
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `Compiler terminated by ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Keep fixture paths stable while preserving paths for every unexpected diagnostic. */
function fileOf(file, directory) {
  return file ? relative(directory, isAbsolute(file) ? file : resolve(directory, file)).replaceAll("\\", "/") : "<compiler>";
}

/** Parse every native diagnostic, refusing output that the parser cannot account for. */
function nativeDiagnostics(output, directory) {
  /** Continuation lines belong to the preceding diagnostic rather than a new result. */
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    /** A file diagnostic includes the source location and its TypeScript code. */
    const located = /^(.*?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (located) {
      diagnostics.push({ file: fileOf(located[1], directory), line: Number(located[2]), code: Number(located[4]), message: located[5] });
      continue;
    }
    /** Options and global errors can have no source location. */
    const global = /^error TS(\d+): (.*)$/.exec(line);
    if (global) {
      diagnostics.push({ file: "<compiler>", line: 0, code: Number(global[1]), message: global[2] });
      continue;
    }
    assert.ok(/^\s/.test(line) && diagnostics.length > 0, `Unrecognized compiler output: ${line}`);
    diagnostics[diagnostics.length - 1].message += `\n${line}`;
  }
  return diagnostics;
}

/** Require each declared diagnostic and reject every unlisted diagnostic. */
function verify(diagnostics, manifest, compiler) {
  /** Each fixture resides in the same package-relative directory in both runs. */
  const expectedFiles = new Set(manifest.map((fixture) => `test/fixtures/wide-config-gate/${fixture.file}`));
  assert.deepEqual(diagnostics.filter((diagnostic) => !expectedFiles.has(diagnostic.file)), [], `${compiler}: unexpected diagnostics`);
  for (const fixture of manifest) {
    /** Preserve the compiler's diagnostic order within each source file. */
    const actual = diagnostics.filter((diagnostic) => diagnostic.file === `test/fixtures/wide-config-gate/${fixture.file}`);
    assert.equal(actual.length, fixture.diagnostics.length, `${compiler}: ${fixture.file}: ${JSON.stringify(actual)}`);
    fixture.diagnostics.forEach((expected, index) => {
      /** The exact count above establishes that this diagnostic exists. */
      const diagnostic = actual[index];
      assert.equal(diagnostic.code, expected.code, `${compiler}: ${fixture.file}: diagnostic code`);
      assert.equal(diagnostic.line, expected.line, `${compiler}: ${fixture.file}: diagnostic line`);
      assert.ok(diagnostic.message.includes(expected.message), `${compiler}: ${fixture.file}: ${diagnostic.message}`);
      if (fixture.file.includes("-B")) {
        assert.ok(!diagnostic.message.includes("ConfigNotLiteral"), `${compiler}: ${fixture.file}: wrong literal diagnostic`);
      }
    });
  }
}

/** Compare codes and source lines independently of message formatting and file ordering. */
function diagnosticKeys(diagnostics) {
  return diagnostics.map(({ file, line, code }) => `${file}:${line}:TS${code}`).sort();
}

/** Materialize the exact committed fixtures and check both compilers against their manifest. */
function main() {
  /** The help route performs no compilation or temporary-file creation. */
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("node scripts/check-wide-config-gate.mjs --tsgo PATH [--source-root PACKAGE_DIR] [--report FILE] [--keep-temp]");
    return;
  }
  /** Resolve all user paths before creating the isolated compiler directory. */
  const options = optionsOf(args);
  /** Read the shared expectations rather than deriving them from compiler output. */
  const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(fixtureRoot, "manifest.json"), "utf8")));
  /** The temporary layout preserves the fixture imports exactly as committed. */
  const directory = mkdtempSync(join(tmpdir(), "wide-config-acceptance-"));
  try {
    /** The fixture files keep the same paths relative to the source package. */
    const destination = join(directory, "test/fixtures/wide-config-gate");
    mkdirSync(destination, { recursive: true });
    symlinkSync(join(options.sourceRoot, "src"), join(directory, "src"), "dir");
    symlinkSync(join(options.sourceRoot, "node_modules"), join(directory, "node_modules"), "dir");
    /** The complete fixture set includes the shared support module. */
    const fixtureFiles = readdirSync(fixtureRoot).filter((file) => file.endsWith(".ts.txt"));
    for (const file of fixtureFiles) writeFileSync(join(destination, file.slice(0, -4)), readFileSync(join(fixtureRoot, file)));
    assert.deepEqual(manifest.map(({ file }) => file).sort(), fixtureFiles.filter((file) => file !== "support.ts.txt").map((file) => file.slice(0, -4)).sort(), "every fixture needs exactly one manifest entry");
    /** Both compilers consume this same JSON configuration and physical source text. */
    const config = {
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, noErrorTruncation: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", types: ["node"], typeRoots: ["./node_modules/@types"] },
      files: fixtureFiles.map((file) => `test/fixtures/wide-config-gate/${file.slice(0, -4)}`)
    };
    writeFileSync(join(directory, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
    /** Parse the shared options with TypeScript, retaining configuration diagnostics. */
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, directory);
    /** TypeScript's API reports the complete pre-emit diagnostic list. */
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    /** Every diagnostic receives the same stable representation as the native results. */
    const typescriptDiagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => ({
      file: fileOf(diagnostic.file?.fileName, directory),
      line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 0,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    }));
    /** Record the external compiler's exact version instead of assuming a package version. */
    const version = runNative(options.tsgo, ["--version"], directory);
    assert.equal(version.status, 0, `${version.stdout}${version.stderr}`);
    assert.equal(version.stderr, "", "unexpected native version output on stderr");
    /** Native compilation uses the same physical files and configuration as TypeScript. */
    const native = runNative(options.tsgo, ["--project", join(directory, "tsconfig.json"), "--pretty", "false"], directory);
    /** Both output streams contribute to the diagnostic set; no error line is filtered. */
    const nativeResults = nativeDiagnostics(`${native.stdout}\n${native.stderr}`, directory);
    assert.equal(native.status, nativeResults.length === 0 ? 0 : 1, `unexpected compiler exit status: ${native.status}`);
    /** Preserve complete diagnostics when the caller requests a durable report. */
    const report = {
      typescript: ts.version,
      tsgo: version.stdout.trim(),
      fixtures: manifest.length,
      expectedDiagnostics: manifest.reduce((count, fixture) => count + fixture.diagnostics.length, 0),
      typescriptDiagnostics,
      tsgoDiagnostics: nativeResults
    };
    if (options.report) writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
    verify(typescriptDiagnostics, manifest, `TypeScript ${ts.version}`);
    verify(nativeResults, manifest, version.stdout.trim());
    assert.deepEqual(diagnosticKeys(nativeResults), diagnosticKeys(typescriptDiagnostics), "compilers disagree on a diagnostic code or line");
    console.log(JSON.stringify({ typescript: ts.version, tsgo: version.stdout.trim(), fixtures: manifest.length, diagnosticsPerCompiler: typescriptDiagnostics.length, unexpectedDiagnostics: 0, result: "passed" }));
  } finally {
    if (options.keepTemp) console.log(`Temporary fixture directory: ${directory}`);
    else rmSync(directory, { recursive: true, force: true });
  }
}

main();
