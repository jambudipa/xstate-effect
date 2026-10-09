/**
 * PARITY-4: the upstream files that task phase 4 rewrites (SD-2).
 *
 * Each rewrite check (`[PARITY-4] upstream/<file>`) runs the parity checker on the rewrite
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

describe("PARITY-4", () => {

  it.effect("[PARITY-4] upstream/assign.test.ts rewrites test/assign.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/assign.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/assign.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 14)
      assert.strictEqual(report.annotatedRunnable, 14)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/stateIn.test.ts rewrites test/stateIn.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/stateIn.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/stateIn.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 9)
      assert.strictEqual(report.annotatedRunnable, 9)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/setup.types.test.ts rewrites test/setup.types.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/setup.types.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/setup.types.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 156)
      assert.strictEqual(report.annotatedRunnable, 156)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/types.test.ts rewrites test/types.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/types.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/types.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 231)
      assert.strictEqual(report.annotatedRunnable, 230)
      assert.strictEqual(report.notPortedRunnable, 1)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/scxml.test.ts rewrites test/scxml.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/scxml.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/scxml.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 169)
      assert.strictEqual(report.annotatedRunnable, 169)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/assert.test.ts rewrites test/assert.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/assert.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/assert.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/input.test.ts rewrites test/input.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/input.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/input.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 15)
      assert.strictEqual(report.annotatedRunnable, 15)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/spawn.test.ts rewrites test/spawn.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/spawn.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/spawn.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 1)
      assert.strictEqual(report.annotatedRunnable, 1)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-4] upstream/spawn.types.test.ts rewrites test/spawn.types.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/spawn.types.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/spawn.types.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))
})
