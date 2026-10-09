/**
 * PARITY-3: the upstream files that task phase 3 rewrites (SD-2).
 *
 * Each rewrite check (`[PARITY-3] upstream/<file>`) runs the parity checker on the rewrite
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

describe("PARITY-3", () => {

  it.effect("[PARITY-3] upstream/clock.test.ts rewrites test/clock.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/clock.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/clock.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 1)
      assert.strictEqual(report.annotatedRunnable, 1)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/definition.test.ts rewrites test/definition.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/definition.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/definition.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 1)
      assert.strictEqual(report.annotatedRunnable, 1)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/tags.test.ts rewrites test/tags.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/tags.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/tags.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 6)
      assert.strictEqual(report.annotatedRunnable, 6)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/mapState.test.ts rewrites test/mapState.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/mapState.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/mapState.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 15)
      assert.strictEqual(report.annotatedRunnable, 15)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/meta.test.ts rewrites test/meta.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/meta.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/meta.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 21)
      assert.strictEqual(report.annotatedRunnable, 21)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/state.test.ts rewrites test/state.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/state.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/state.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 21)
      assert.strictEqual(report.annotatedRunnable, 21)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/route.test.ts rewrites test/route.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/route.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/route.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 13)
      assert.strictEqual(report.annotatedRunnable, 13)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/eventDescriptors.test.ts rewrites test/eventDescriptors.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/eventDescriptors.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/eventDescriptors.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 15)
      assert.strictEqual(report.annotatedRunnable, 15)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/resolve.test.ts rewrites test/resolve.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/resolve.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/resolve.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 1)
      assert.strictEqual(report.annotatedRunnable, 1)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/match.test.ts rewrites test/match.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/match.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/match.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 13)
      assert.strictEqual(report.annotatedRunnable, 13)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/machine.test.ts rewrites test/machine.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/machine.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/machine.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 20)
      assert.strictEqual(report.annotatedRunnable, 20)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/after.test.ts rewrites test/after.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/after.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/after.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 9)
      assert.strictEqual(report.annotatedRunnable, 9)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/microstep.test.ts rewrites test/microstep.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/microstep.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/microstep.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 11)
      assert.strictEqual(report.annotatedRunnable, 11)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/invalid.test.ts rewrites test/invalid.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/invalid.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/invalid.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 6)
      assert.strictEqual(report.annotatedRunnable, 6)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-3] upstream/json.test.ts rewrites test/json.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/json.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/json.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 3)
      assert.strictEqual(report.annotatedRunnable, 3)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))
})
