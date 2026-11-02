/**
 * Reproduces A5's erased-spread counterexample without accepting the unsafe machine.
 * Exit zero means the limitation was reproduced; the report still marks acceptance failed.
 * This forensic CLI is deliberately outside the test-suite import graph.
 * @since 0.4.0
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The installed package supplies the default source and dependency directories. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Each unsafe spread has a control with the same visible state properties. */
const fixture = `import { assign, setup } from "./src/index.js"
import { markAgentLogic } from "./src/internal/agentBrand.js"
import { fromEffect } from "./src/actors/index.js"
import { Effect } from "effect"
/** The registered actor requires settlement. */
const agent = markAgentLogic(fromEffect((_: { input: number }) => Effect.succeed(1)))
/** Both pairs use the same agent setup. */
const s = setup({ actors: { agent } })
/** The hidden agent lacks onDone, and its state has no progress guarantee. */
const wideStates: Readonly<Record<string, object>> = { hidden: { invoke: { src: "agent", input: 1 } } }
/** A5 counterexample: an explicit property erases the spread's index signature. */
export const spreadOnly = s.createMachine({ initial: "done", states: { ...wideStates, done: { type: "final" } } })
/** The visible final state is the complete state map in this control. */
export const plainOnly = s.createMachine({ initial: "done", states: { done: { type: "final" } } })
/** The same unsafe spread also works with C1's root assign form. */
export const spreadAssign = s.createMachine({ initial: "x", entry: assign({}), states: { ...wideStates, x: { after: { 1: "done" } }, done: { type: "final" } } })
/** This is the valid root assign form that acceptance criterion C1 requires. */
export const plainAssign = s.createMachine({ initial: "x", entry: assign({}), states: { x: { after: { 1: "done" } }, done: { type: "final" } } })
/** C4 requires a valid const config variable to compile. */
const plainConfig = { initial: "x", states: { x: { after: { 1: "done" } }, done: { type: "final" } } } as const
/** A normal structural annotation gives the unsafe variable exactly the control's declared type. */
const spreadConfig: typeof plainConfig = { initial: "x", states: { ...wideStates, x: { after: { 1: "done" } }, done: { type: "final" } } } as const
/** Passing a variable also removes the call site's access to the spread syntax. */
export const spreadConst = s.createMachine(spreadConfig)
/** This valid const-variable control has the same static type as spreadConfig. */
export const plainConst = s.createMachine(plainConfig)
`;

/** Parse explicit paths without installing tools or changing source files. */
function optionsOf(args) {
  /** Native compilation is optional; an omitted executable is reported as not run. */
  const options = { sourceRoot: packageRoot, tsgo: undefined, report: undefined, keepTemp: false };
  for (let index = 0; index < args.length; index++) {
    /** A flag consumes at most one following path. */
    const flag = args[index];
    if (flag === "--keep-temp") options.keepTemp = true;
    else {
      assert.ok(["--source-root", "--tsgo", "--report"].includes(flag), `Unknown option: ${flag}`);
      /** A missing value must fail before the temporary directory is created. */
      const value = args[++index];
      assert.ok(value && !value.startsWith("--"), `Missing value for ${flag}`);
      if (flag === "--source-root") options.sourceRoot = resolve(value);
      else if (flag === "--report") options.report = resolve(value);
      else options.tsgo = value.includes("/") ? resolve(value) : value;
    }
  }
  return options;
}

/** Capture both native compiler streams and process failures without filtering output. */
function runNative(executable, args, directory) {
  /** No shell interprets the executable path or compiler arguments. */
  const result = spawnSync(executable, args, { cwd: directory, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message ?? null };
}

/** Read inferred parameters when this compiler exposes the observed mapper structure. */
function inferredParameters(signature, format) {
  /** Mapper details are supplementary evidence, not a stable TypeScript API contract. */
  const mapper = signature.mapper;
  if (!Array.isArray(mapper?.sources) || !Array.isArray(mapper?.targets) || mapper.sources.length !== mapper.targets.length) return null;
  return mapper.sources.map((source, index) => ({ name: source.symbol?.name ?? null, type: format(mapper.targets[index]) }));
}

/** Capture the complete public argument and return types for every exported machine. */
function machineTypes(program, file) {
  /** The same checker provides diagnostics, contextual argument types, and return types. */
  const checker = program.getTypeChecker();
  /** Type text is never truncated in the evidence. */
  const format = (type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  /** The fixture is generated above and must remain available to its program. */
  const source = program.getSourceFile(file);
  assert.ok(source, "The compiler did not load the generated fixture");
  /** Preserve each complete type independently before comparing the controls. */
  const machines = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      assert.ok(declaration.initializer && ts.isCallExpression(declaration.initializer), "An exported fixture must be a machine call");
      /** Every exported call uses the public setup signature under investigation. */
      const call = declaration.initializer;
      /** A missing signature invalidates the reproduction instead of hiding evidence. */
      const signature = checker.getResolvedSignature(call);
      assert.ok(signature, "The compiler did not resolve a machine signature");
      /** The public return type remains available even when mapper internals change. */
      const returned = checker.getReturnTypeOfSignature(signature);
      machines.push({
        name: declaration.name.getText(),
        line: source.getLineAndCharacterOfPosition(call.getStart()).line + 1,
        argument: format(checker.getTypeAtLocation(call.arguments[0])),
        returnedType: format(returned),
        returnedConfig: returned.aliasSymbol?.name === "SetupMachine" && returned.aliasTypeArguments?.[8] ? format(returned.aliasTypeArguments[8]) : null,
        inferredParameters: inferredParameters(signature, format)
      });
    }
  }
  return machines;
}

/** Compare unsafe/control pairs without interpreting unsafe compilation as acceptance. */
function comparePairs(machines) {
  return [["spreadOnly", "plainOnly", "A5 control"], ["spreadAssign", "plainAssign", "C1"], ["spreadConst", "plainConst", "C4"]].map(([spreadName, plainName, requiredControl]) => {
    /** A missing machine invalidates the reproduction rather than becoming an empty match. */
    const spread = machines.find((machine) => machine.name === spreadName);
    /** C1 requires the plain assign control to compile. */
    const plain = machines.find((machine) => machine.name === plainName);
    assert.ok(spread && plain, `Missing pair: ${spreadName}/${plainName}`);
    return {
      spread: spreadName,
      plain: plainName,
      requiredControl,
      argumentEqual: spread.argument === plain.argument,
      returnedTypeEqual: spread.returnedType === plain.returnedType,
      returnedConfigEqual: spread.returnedConfig !== null && plain.returnedConfig !== null ? spread.returnedConfig === plain.returnedConfig : null,
      inferredParametersEqual: spread.inferredParameters !== null && plain.inferredParameters !== null ? JSON.stringify(spread.inferredParameters) === JSON.stringify(plain.inferredParameters) : null
    };
  });
}

/** Compile the forensic fixture, report its complete evidence, and clean up owned files. */
function main() {
  /** Help performs no compilation or filesystem mutation. */
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("node scripts/repro-wide-spread.mjs [--tsgo PATH] [--source-root PACKAGE_DIR] [--report FILE] [--keep-temp]");
    return;
  }
  /** Validate all options before creating the isolated compiler directory. */
  const options = optionsOf(args);
  /** All generated files belong to this reproduction alone. */
  const directory = mkdtempSync(join(tmpdir(), "wide-spread-forensic-"));
  try {
    symlinkSync(join(options.sourceRoot, "src"), join(directory, "src"), "dir");
    symlinkSync(join(options.sourceRoot, "node_modules"), join(directory, "node_modules"), "dir");
    /** Both compilers read the same physical fixture and configuration. */
    const file = join(directory, "counterexample.ts");
    writeFileSync(file, fixture);
    /** Strict options match the acceptance fixture runner. */
    const config = { compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, noErrorTruncation: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", types: ["node"], typeRoots: ["./node_modules/@types"] }, files: ["counterexample.ts"] };
    writeFileSync(join(directory, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
    /** Retain configuration diagnostics as well as source diagnostics. */
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, directory);
    /** The compiler API avoids diagnostic filtering through shell output. */
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    /** Every diagnostic retains its full message, code, and source position. */
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => ({ file: diagnostic.file ? relative(directory, diagnostic.file.fileName) : null, line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 0, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") }));
    /** Capture the inferred types before releasing the compiler program. */
    const machines = machineTypes(program, file);
    /** Compare the simple control, the required C1 assign form, and the C4 const variable. */
    const pairs = comparePairs(machines);
    /** An omitted native compiler is explicit in the report. */
    const native = options.tsgo ? { version: runNative(options.tsgo, ["--version"], directory), compilation: runNative(options.tsgo, ["--project", join(directory, "tsconfig.json"), "--pretty", "false"], directory) } : null;
    /** Any supplied native compiler must report the same absence of diagnostics. */
    const nativeReproduced = native === null || (native.version.status === 0 && /^Version 7\./.test(native.version.stdout.trim()) && native.version.stderr === "" && native.version.error === null && native.compilation.status === 0 && native.compilation.stdout === "" && native.compilation.stderr === "" && native.compilation.error === null);
    /** Zero diagnostics are the defect being demonstrated, never an acceptance success. */
    const reproduced = diagnostics.length === 0 && machines.length === 6 && pairs.every((pair) => pair.argumentEqual && pair.returnedTypeEqual && pair.returnedConfigEqual !== false && pair.inferredParametersEqual !== false) && nativeReproduced;
    /** Source hashes distinguish uncommitted candidate revisions without reading Git secrets. */
    const sourceHashes = Object.fromEntries(["setup.ts", "settlement.ts"].map((name) => [name, createHash("sha256").update(readFileSync(join(options.sourceRoot, "src", name))).digest("hex")]));
    /** The result separates forensic reproduction from acceptance of the requested fix. */
    const report = {
      result: reproduced ? "A5 counterexample reproduced" : "reproduction changed unexpectedly",
      acceptance: reproduced ? "failed" : "not established",
      safeToAcceptCandidate: false,
      sourceRoot: options.sourceRoot,
      sourceHashes,
      typescript: { version: ts.version, diagnosticCount: diagnostics.length, diagnostics },
      tsgo: native ?? { status: "not run" },
      pairs,
      machines,
      fixture,
      temporaryDirectory: options.keepTemp ? directory : null,
      inference: "The compiler exposes identical argument and return types for each pair. A check that inspects only those types cannot recover the erased spread source. This observation does not prove every possible replacement API impossible."
    };
    if (options.report) writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!reproduced) process.exitCode = 1;
  } finally {
    if (!options.keepTemp) rmSync(directory, { recursive: true, force: true });
  }
}

main();
