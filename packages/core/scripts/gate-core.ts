/**
 * @since 0.4.0
 * @module scripts/gate-core
 *
 * The pure logic of the `xstate-effect-certify-gate` bin (`gate.ts`): its command line, and how it
 * decides a finished run. It holds no capability, so a test can reach it (CONF-8), and it ships
 * beside the bin, compiled to `dist/scripts/gate-core.js`.
 */
import { Option, Schema } from "effect"

/** The flag that tells the certify bin to read a report nonce from its stdin. */
export const nonceFlag = "--report-nonce-stdin"

/** The time limit of one bin run, past which the gate kills it. */
const defaultTimeoutMs = 120_000

/** One named failure, as the bin prints it. */
const Failure = Schema.Struct({
  check: Schema.String,
  machine: Schema.optionalKey(Schema.String),
  detail: Schema.String,
})

/** The bin's whole stdout under the gate. One JSON value, so any other output beside the report fails to decode. */
const RunReport = Schema.fromJsonString(
  Schema.Struct({ passed: Schema.Boolean, failures: Schema.Array(Failure), nonce: Schema.String })
)

/** A report in the bin's form, which the gate prints with no nonce. */
export interface Report {
  /** Whether the run passed. */
  readonly passed: boolean
  /** Each named failure of the run. */
  readonly failures: ReadonlyArray<typeof Failure.Type>
}

/** A report with one failure of the gate's own. */
export const failed = (check: string, detail: string): Report => ({ passed: false, failures: [{ check, detail }] })

/** Reads the command line, or gives a failure: a gate over the wrong arguments must not pass. */
export const readArguments = (argv: ReadonlyArray<string>) => {
  const usage = failed("usage", "usage: xstate-effect-certify-gate <config> [--timeout-ms <ms>]")
  const flag = argv.indexOf("--timeout-ms")
  const value = flag < 0 ? String(defaultTimeoutMs) : argv[flag + 1]
  const rest = flag < 0 ? argv : argv.filter((_, index) => index !== flag && index !== flag + 1)
  const timeoutMs = Number(value)
  const config = rest[0]
  if (config === undefined || rest.length > 1 || config.startsWith("--")) return usage
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return usage
  return { config, timeoutMs }
}

/**
 * Decides a finished run from its exit code, its whole stdout and the nonce of the run. Anything
 * but one consistent report that holds the nonce is a failure. A config shares the bin's stdout
 * and exit code, so only the nonce, which the bin read before it loaded the config, tells the
 * bin's report from a config's.
 */
export const judge = (code: number | null, stdout: string, nonce: string): Report => {
  if (stdout.trim().length === 0) return failed("no-report", `the bin ended with exit ${code} and no report`)
  return Option.match(Schema.decodeUnknownOption(RunReport)(stdout), {
    onNone: () => failed("malformed-report", "the bin's stdout is not exactly one report of this run"),
    onSome: ({ passed, failures, nonce: reported }) => {
      if (reported !== nonce) return failed("forged-report", "the report does not hold the nonce of this run")
      if (!passed && failures.length > 0 && code !== 0) return { passed, failures }
      if (passed && failures.length === 0 && code === 0) return { passed, failures }
      return failed("inconsistent-report", `exit ${code} with passed ${passed} and ${failures.length} failures`)
    },
  })
}
