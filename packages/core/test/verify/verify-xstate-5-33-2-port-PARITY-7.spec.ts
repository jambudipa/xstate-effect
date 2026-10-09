/**
 * PARITY-7: the upstream files that task phase 7 rewrites (SD-2).
 *
 * Each rewrite check (`[PARITY-7] upstream/<file>`) runs the parity checker on the rewrite
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

describe("PARITY-7", () => {

  it.effect("[PARITY-7] upstream/graph/adjacency.test.ts rewrites src/graph/test/adjacency.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/adjacency.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/adjacency.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/dieHard.test.ts rewrites src/graph/test/dieHard.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/dieHard.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/dieHard.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 29)
      assert.strictEqual(report.annotatedRunnable, 29)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/events.test.ts rewrites src/graph/test/events.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/events.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/events.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/forbiddenAttributes.test.ts rewrites src/graph/test/forbiddenAttributes.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/forbiddenAttributes.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/forbiddenAttributes.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 3)
      assert.strictEqual(report.annotatedRunnable, 3)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/graph.test.ts rewrites src/graph/test/graph.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/graph.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/graph.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 22)
      assert.strictEqual(report.annotatedRunnable, 22)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/index.test.ts rewrites src/graph/test/index.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/index.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/index.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 12)
      assert.strictEqual(report.annotatedRunnable, 12)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/paths.test.ts rewrites src/graph/test/paths.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/paths.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/paths.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 13)
      assert.strictEqual(report.annotatedRunnable, 13)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/shortestPaths.test.ts rewrites src/graph/test/shortestPaths.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/shortestPaths.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/shortestPaths.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 4)
      assert.strictEqual(report.annotatedRunnable, 4)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/states.test.ts rewrites src/graph/test/states.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/states.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/states.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-7] upstream/graph/testModel.test.ts rewrites src/graph/test/testModel.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("src/graph/test/testModel.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/graph/testModel.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))
})
