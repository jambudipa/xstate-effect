#!/usr/bin/env node
/**
 * @since 0.4.0
 * @module scripts/gate
 *
 * The `xstate-effect-certify-gate` bin, the fail-closed gate over `xstate-effect-certify <config>
 * --check`: `xstate-effect-certify-gate <config> [--timeout-ms <ms>]`. Exit 0 proves only that a
 * process ended: a config that calls `process.exit(0)` ends the bin with exit 0 and no report, and
 * a load that hangs never ends. So this process runs the bin under a time limit and passes only
 * on exactly one report that says `passed: true`, names no failure, agrees with the exit code and
 * holds the nonce of this run.
 *
 * A config runs arbitrary code in the bin's process and shares its stdout, so it could print a
 * report of its own and exit 0. The gate gives the bin a fresh nonce on stdin, and the bin reads
 * it before it loads the config, so a report printed at load, or by a machine, has no nonce to
 * hold and fails. This closes a report a config writes for itself, not a config that attacks the
 * bin: code in that process can patch `process.stdout.write` or `JSON.stringify` to rewrite the
 * real report, read the nonce through `node:inspector`, or change a machine or the library before
 * the check runs. The gate is no sandbox. Run it only over a config you trust as you trust the
 * machines it names, and read a change to a config as you read code.
 *
 * It prints one JSON report in the bin's form, `{ passed, failures }`, and exits 1 unless it
 * passed. The bin runs under the runtime and the flags that run this file, as a certificate must
 * be checked under the runtime that wrote it.
 */
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { failed, judge, nonceFlag, readArguments, type Report } from "./gate-core.js"

/** The most bytes of stdout the gate reads: a report past this is no report it can trust. */
const maxReportBytes = 16 * 1024 * 1024

/**
 * Runs the bin under this process's own flags, so a loader survives, and kills it at the limit.
 * The only input is the nonce of this run, which the bin reads before it loads the config.
 */
const runBin = (config: string, timeoutMs: number): Report => {
  const nonce = randomBytes(32).toString("hex")
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, fileURLToPath(new URL("./certify.js", import.meta.url)), config, "--check", nonceFlag],
    {
      encoding: "utf8",
      input: nonce,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: maxReportBytes,
      stdio: ["pipe", "pipe", "inherit"],
    }
  )
  const error: NodeJS.ErrnoException | undefined = child.error
  if (error?.code === "ETIMEDOUT") return failed("timeout", `the bin passed its limit of ${timeoutMs} ms`)
  if (error !== undefined) return failed("spawn", error.message)
  return judge(child.status, child.stdout, nonce)
}

/** The command line, or the failure that refuses it. */
const parsed = readArguments(process.argv.slice(2))
/** The gate's result, which alone sets the exit code. */
const report = "failures" in parsed ? parsed : runBin(parsed.config, parsed.timeoutMs)
report.failures.forEach((failure) => process.stderr.write(`gate: ${failure.check}: ${failure.detail}\n`))
process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(report.passed ? 0 : 1))
