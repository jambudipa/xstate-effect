/**
 * PARITY-6: the upstream files that task phase 6 rewrites (SD-2).
 *
 * Each rewrite check (`[PARITY-6] upstream/<file>`) runs the parity checker on the rewrite
 * with the real ledger, asserts that it reports no gap, and that the ledger no longer lists
 * the file as `not started`. The rewrite tasks of the phase add one check per file.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { posix } from "node:path"
import { checkRewrite, formatGap, PKG_ROOT, readLedger, readManifest } from "./parity.js"

const readModule = (relative: string): string | null => {
  const absolute = posix.join(PKG_ROOT, relative)
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null
}

/**
 * The parity of the rewrite of one upstream test file, checked against the frozen manifest
 * and the "Tests not ported" rows of the real ledger, with the file's ledger row.
 */
const rewriteParity = (upstreamPath: string) => {
  const upstream = readManifest().files.find((file) => file.path === upstreamPath)
  if (upstream === undefined) throw new Error(`${upstreamPath} is not in the manifest`)
  const { ledger, problems } = readLedger()
  assert.deepStrictEqual(problems, [], "the ledger parses")
  const row = ledger.files.find((candidate) => candidate["Upstream file"] === upstreamPath)
  if (row === undefined) throw new Error(`${upstreamPath} has no row in the ledger`)
  const rewritePath = row["Rewrite"] ?? ""
  const report = checkRewrite({
    upstream,
    rewritePath,
    source: readModule(rewritePath),
    notPorted: ledger.notPorted,
    readModule
  })
  return { report, row }
}

describe("PARITY-6", () => {

  it.effect("[PARITY-6] upstream/getNextSnapshot.test.ts rewrites test/getNextSnapshot.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/getNextSnapshot.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/getNextSnapshot.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 3)
      assert.strictEqual(report.annotatedRunnable, 3)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-6] upstream/issue5454.test.ts rewrites test/issue5454.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/issue5454.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/issue5454.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 5)
      assert.strictEqual(report.annotatedRunnable, 5)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-6] upstream/toPromise.test.ts rewrites test/toPromise.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/toPromise.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/toPromise.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 5)
      assert.strictEqual(report.annotatedRunnable, 5)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-6] upstream/transition.test.ts rewrites test/transition.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/transition.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/transition.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 24)
      assert.strictEqual(report.annotatedRunnable, 24)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-6] upstream/waitFor.test.ts rewrites test/waitFor.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/waitFor.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/waitFor.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 16)
      assert.strictEqual(report.annotatedRunnable, 16)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))
})
