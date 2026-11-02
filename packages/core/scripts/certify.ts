#!/usr/bin/env node
/**
 * @since 0.4.0
 * @module scripts/certify
 *
 * The `xstate-effect-certify` bin: `xstate-effect-certify <config> [--check]`. It runs `explore`
 * and `certify` over the machines a config module names, and writes their certificate module.
 * With `--check` it writes nothing: it derives every certificate again and compares it with the
 * module, so the file is never trusted (AUDIT-3, decision 16).
 *
 * It prints one JSON report to stdout, and one line per failure to stderr. Any failure or crash
 * exits non-zero, and every failure names its check. The build compiles this file to
 * `dist/scripts/certify.js`, as a runtime will not strip types under `node_modules`. An exit code
 * proves little, as a config can end the process: `xstate-effect-certify-gate` runs this bin and
 * reads its report, and its flag `--report-nonce-stdin` belongs to that gate alone.
 *
 * Run it under the runtime the machines run on, as a function hashes by its source text and a
 * transpiler can print one differently: `bun --bun xstate-effect-certify <config>`. That runtime
 * also has to load the config, which a plain `node` does not do for every TypeScript module.
 */
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { AnyStateMachine, SettlementCertificate } from "@jambudipa/xstate-effect"
import {
  CertificateCheckError,
  certify,
  checkCertificate,
  explore,
  moduleClosure,
  proveSettlement,
  type CertificateExploration,
  type CertificateModule,
  type CertifyConfig,
  type CertifyTarget,
  unresolvedImports,
} from "@jambudipa/xstate-effect/graph"
import { Array as Arr, Cause, Data, Effect, Exit, FileSystem, Layer, Option, Order, Path, Predicate, Schema } from "effect"
import { systemError } from "effect/PlatformError"
import { isConfigShape } from "./certify-core.js"
import { nonceFlag } from "./gate-core.js"

/** One named failure of a run; `machine` is absent when it is not one machine's. */
interface Failure {
  /** The check: a field of a certificate, a failure's tag, or a stage such as `missing`. */
  readonly check: string
  /** The config's name for the machine. */
  readonly machine?: string
  /** What went wrong. */
  readonly detail: string
}

/** A failure that ends the run before it has a report for each machine. */
class Stop extends Data.TaggedError("Stop")<{ readonly failure: Failure }> {}

/**
 * The gate's nonce of this run, read before the config loads, so nothing a config prints can hold
 * it. A plain run has none, and its report holds no nonce field.
 */
const reportNonce = process.argv.includes(nonceFlag) ? Option.some(readFileSync(0, "utf8")) : Option.none<string>()

/** The schema of a generated certificate, read back from the module's text. */
const RecordedCertificate = Schema.fromJsonString(
  Schema.Struct({
    states: Schema.Array(Schema.String),
    edges: Schema.Array(Schema.String),
    explored: Schema.Number,
    hash: Schema.String,
    verdict: Schema.Literals(["proved", "failed"]),
  })
)

/** The only `FileSystem` operations `moduleClosure` uses, as the package has no platform dependency. */
const files = FileSystem.layerNoop({
  stat: (file) =>
    Effect.try({
      try: () => ({ type: statSync(file).isFile() ? "File" : "Directory" }) as FileSystem.File.Info,
      catch: (cause) => unreadable("stat", file, cause),
    }),
  readFileString: (file) =>
    Effect.try({ try: () => readFileSync(file, "utf8"), catch: (cause) => unreadable("readFileString", file, cause) }),
  realPath: (file) =>
    Effect.try({ try: () => realpathSync(file), catch: (cause) => unreadable("realPath", file, cause) }),
})

/** The error of a file operation that failed. */
const unreadable = (method: string, file: string, cause: unknown) =>
  systemError({ _tag: "Unknown", module: "FileSystem", method, pathOrDescriptor: file, cause })

/** Reads the command line: one config path, and `--check` or nothing, beside the gate's flag. */
const readArguments = (argv: ReadonlyArray<string>) => {
  const flags = argv.filter((each) => each.startsWith("--") && each !== nonceFlag)
  const positional = argv.filter((each) => !each.startsWith("--"))
  const config = positional[0]
  if (config === undefined || positional.length > 1 || flags.some((flag) => flag !== "--check")) {
    return Effect.fail(
      new Stop({ failure: { check: "usage", detail: "usage: xstate-effect-certify <config> [--check]" } })
    )
  }
  return Effect.succeed({ configFile: resolve(config), check: flags.length > 0 })
}

/** Loads the config module; a module that throws is a named failure. */
const loadConfig = (configFile: string) =>
  Effect.tryPromise({
    try: (): Promise<unknown> => import(pathToFileURL(configFile).href),
    catch: (cause) => new Stop({ failure: { check: "load", detail: `${configFile}: ${String(cause)}` } }),
  }).pipe(
    Effect.flatMap((loaded) => {
      const config = Predicate.hasProperty(loaded, "default") ? loaded.default : undefined
      if (isConfig(config)) return Effect.succeed(config)
      return Effect.fail(
        new Stop({
          failure: {
            check: "config",
            detail: `${configFile}: the default export needs an output and at least one machine with an environment, and a layer that is a Layer`,
          },
        })
      )
    })
  )

/** Whether a value is a config, by the checks of `certify-core.ts`. */
const isConfig = (value: unknown): value is CertifyConfig => isConfigShape(value)

/**
 * The module closure of the config, without the certificate module. A machine may import its
 * certificate, and a hash that covered it would change with every write. An import of a module
 * that does not exist yet would be a real unresolved import, so write mode first makes the file.
 */
const closureOf = (configFile: string, outputFile: string) =>
  moduleClosure(configFile).pipe(
    Effect.flatMap((modules) => {
      const output = relative(dirname(configFile), outputFile)
      const kept = modules.filter((each: CertificateModule) => each.path !== output)
      if (Arr.isReadonlyArrayNonEmpty(kept)) return Effect.succeed(kept)
      return Effect.fail(new Stop({ failure: { check: "config", detail: "the output is the config module" } }))
    })
  )

/** Provides a target's own layer to the explorer: a guard's services are the only ones a run needs. */
const withLayer = <A, E, R>(target: CertifyTarget, effect: Effect.Effect<A, E, R>) =>
  target.layer === undefined ? effect : Effect.provide(effect, target.layer)

/** The check and text of a failed exploration: an explorer failure, or a layer that did not build. */
const namedFailure = (failure: unknown): { readonly check: string; readonly detail: string } =>
  Predicate.hasProperty(failure, "_tag") && Predicate.isString(failure._tag) &&
  Predicate.hasProperty(failure, "message") && Predicate.isString(failure.message)
    ? { check: failure._tag, detail: failure.message }
    : { check: "layer", detail: String(failure) }

/** Runs the explorer once, however often the result is read; a failed proof is a verdict and a named failure. */
const explorationOf = (name: string, target: CertifyTarget, failures: Array<Failure>) =>
  Effect.cached(
    withLayer(target, explore(target.machine, target.environment)).pipe(
      Effect.map((result): CertificateExploration => ({ explored: result.explored })),
      Effect.catch((failure) =>
        Effect.sync((): CertificateExploration => {
          failures.push({ ...namedFailure(failure), machine: name })
          // A count stays out of a failed certificate: a timeout's count differs from run to run
          return { explored: 0, verdict: "failed" }
        })
      )
    )
  )

/** What the structural proof names on a machine it refuses; the explorer names its own failures. */
const proofFindings = (name: string, machine: AnyStateMachine) =>
  proveSettlement(machine).pipe(
    Effect.match({
      onSuccess: (): ReadonlyArray<Failure> => [],
      onFailure: (error) =>
        error.findings.map((finding) => ({ check: finding.kind, machine: name, detail: finding.message })),
    })
  )

/** Derives one machine's certificate, and in check mode compares it with what the module records. */
const analyse = (
  name: string,
  target: CertifyTarget,
  modules: Arr.NonEmptyReadonlyArray<CertificateModule>,
  text: Option.Option<string>
) =>
  Effect.gen(function*() {
    const failures: Array<Failure> = []
    const exploration = yield* explorationOf(name, target, failures)
    const certificate = yield* certify(target.machine, () => exploration, { modules })
    if (certificate.verdict === "failed") failures.push(...(yield* proofFindings(name, target.machine)))
    if (Option.isSome(text)) failures.push(...(yield* compare(name, target, modules, text.value, exploration)))
    return { name, certificate, failures }
  })

/** The named failures of a recorded certificate against the analysis, which derives it all again. */
const compare = <E, R>(
  name: string,
  target: CertifyTarget,
  modules: Arr.NonEmptyReadonlyArray<CertificateModule>,
  text: string,
  exploration: Effect.Effect<CertificateExploration, E, R>
) =>
  Option.match(recordedIn(text, name), {
    onNone: () =>
      Effect.succeed<ReadonlyArray<Failure>>([
        { check: "format", machine: name, detail: `the certificate module has no generated export '${name}'` },
      ]),
    onSome: (recorded) =>
      checkCertificate(target.machine, recorded, () => exploration, { modules }).pipe(
        Effect.as<ReadonlyArray<Failure>>([]),
        Effect.catchIf(
          (error) => error instanceof CertificateCheckError,
          (error) =>
            Effect.succeed(
              error.mismatches.map((each) => ({
                check: each.field,
                machine: name,
                detail: `recorded ${each.recorded}, derived ${each.derived}`,
              }))
            )
        )
      ),
  })

/** Reads one machine's certificate out of a module's text; a hand-written shape is no certificate. */
const recordedIn = (text: string, name: string): Option.Option<SettlementCertificate> => {
  const json = new RegExp(`^export const ${name.replaceAll("$", "\\$")} = (\\{[\\s\\S]*?^\\}) as const$`, "m").exec(text)?.[1]
  return json === undefined ? Option.none() : Schema.decodeUnknownOption(RecordedCertificate)(json)
}

/** The certificate module: each machine's certificate, sorted by name, as one constant. */
const render = (certificates: ReadonlyArray<readonly [string, SettlementCertificate]>) =>
  [
    "// Generated by xstate-effect-certify. Do not edit: run it again.",
    ...certificates.map(([name, certificate]) =>
      `\nexport const ${name} = ${JSON.stringify(certificate, null, 2)} as const`
    ),
    "",
  ].join("\n")

/** One run of the bin; it gives the failures of the run, none when the run passed. */
const run = (argv: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const args = yield* readArguments(argv)
    const config = yield* loadConfig(args.configFile)
    const outputFile = resolve(dirname(args.configFile), config.output)
    if (args.check && !existsSync(outputFile)) {
      return [{ check: "missing", detail: `no certificate module at ${outputFile}` }]
    }
    if (!existsSync(outputFile)) writeFileSync(outputFile, "")
    const text = args.check ? Option.some(readFileSync(outputFile, "utf8")) : Option.none()
    const modules = yield* closureOf(args.configFile, outputFile)
    const targets = Arr.sort(
      Object.entries(config.machines),
      Order.mapInput(Order.String, (entry: readonly [string, CertifyTarget]) => entry[0])
    )
    const results = yield* Effect.forEach(targets, ([name, target]) => analyse(name, target, modules, text))
    const missing = unresolvedImports(modules).map((name) => ({
      check: "unresolved-import",
      detail: `'${name}' resolves to no file, so the hash cannot cover it`,
    }))
    const failures = [...missing, ...results.flatMap((result) => result.failures)]
    const rendered = render(results.map((result) => [result.name, result.certificate] as const))
    if (Option.isNone(text)) {
      writeFileSync(outputFile, rendered)
      return failures
    }
    if (failures.length > 0 || text.value === rendered) return failures
    return [{ check: "text", detail: `${outputFile} differs from the generated module outside the certificates` }]
  }).pipe(
    Effect.catch((error) => {
      if (error instanceof Stop) return Effect.succeed<ReadonlyArray<Failure>>([error.failure])
      return Effect.succeed<ReadonlyArray<Failure>>([{ check: error._tag, detail: error.message }])
    })
  )

/** Prints the report, and ends the process only after stdout has taken it. */
const finish = (failures: ReadonlyArray<Failure>) => {
  failures.forEach((failure) => {
    const owner = failure.machine === undefined ? "" : ` (${failure.machine})`
    process.stderr.write(`xstate-effect-certify: ${failure.check}${owner}: ${failure.detail}\n`)
  })
  const code = failures.length === 0 ? 0 : 1
  const report = { passed: code === 0, failures, ...Option.match(reportNonce, { onNone: () => ({}), onSome: (nonce) => ({ nonce }) }) }
  process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(code))
}

Effect.runPromiseExit(run(process.argv.slice(2)).pipe(Effect.provide(Layer.merge(files, Path.layer)))).then((exit) =>
  finish(
    Exit.match(exit, {
      onSuccess: (failures) => failures,
      onFailure: (cause) => [{ check: "crash", detail: Cause.pretty(cause) }],
    })
  )
)
