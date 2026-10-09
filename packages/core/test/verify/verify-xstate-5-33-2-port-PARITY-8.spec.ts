/**
 * PARITY-8: the upstream file that task phase 8 rewrites (SD-2), and the file-set check of
 * all rewrite phases (AC 29).
 *
 * The rewrite check (`[PARITY-8] upstream/typeHelpers.test.ts`) runs the parity checker on
 * the rewrite with the real ledger, asserts that it reports no gap, and that the ledger no
 * longer lists the file as `not started`.
 *
 * The file-set check reads the rewrite checks of the PARITY-2 to PARITY-8 evidence files (the
 * upstream path that each passes to its `rewriteParity` helper) and asserts that together
 * they name each of the 74 files of the frozen manifest exactly once, each in the evidence
 * file of its ledger rewrite phase.
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

/** The rewrite phases, one PARITY-n evidence file each. */
const PHASES = [2, 3, 4, 5, 6, 7, 8] as const

/**
 * The upstream test paths that the PARITY-n evidence file checks: every upstream test path
 * literal passed to its rewrite-parity helper (`test/...test.ts` or
 * `src/graph/test/...test.ts`). An absent evidence file has no paths.
 */
const phaseFileSet = (phase: number): ReadonlyArray<string> => {
  const source = readModule(`test/verify/verify-xstate-5-33-2-port-PARITY-${phase}.spec.ts`) ?? ""
  const calls = source.matchAll(/rewriteParity\("((?:test|src\/graph\/test)\/[^"]+\.test\.ts)"\)/g)
  return Array.from(calls, (match) => match[1] ?? "")
}

describe("PARITY-8", () => {

  it.effect("[PARITY-8] upstream/typeHelpers.test.ts rewrites test/typeHelpers.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/typeHelpers.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/typeHelpers.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 10)
      assert.strictEqual(report.annotatedRunnable, 10)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-8] the PARITY-2 to PARITY-8 file sets together equal the 74 manifest files, each once, in its ledger rewrite phase", () =>
    Effect.sync(() => {
      const manifestFiles = readManifest().files.map((file) => file.path).sort()
      assert.strictEqual(manifestFiles.length, 74)
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [], "the ledger parses")
      const sets = PHASES.map((phase) => ({ phase, files: phaseFileSet(phase) }))
      for (const { phase, files } of sets) {
        assert.isAbove(files.length, 0, `PARITY-${phase} checks at least one rewrite`)
      }
      const all = sets.flatMap(({ files }) => files)
      const repeated = all.filter((file, index) => all.indexOf(file) !== index)
      assert.deepStrictEqual(repeated, [], "no upstream file is checked twice")
      assert.deepStrictEqual([...all].sort(), manifestFiles)
      const misplaced = sets.flatMap(({ phase, files }) =>
        files
          .filter((file) =>
            ledger.files.find((row) => row["Upstream file"] === file)?.["Rewrite phase"] !== String(phase)
          )
          .map((file) => `${file} in PARITY-${phase}`)
      )
      assert.deepStrictEqual(misplaced, [], "each file sits in the evidence file of its ledger rewrite phase")
    }))


})
