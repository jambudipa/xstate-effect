/**
 * The CONF import and count checks of SD-2 (scenarios CONF-2..8, HARNESS-1).
 *
 * A CONF-n evidence file imports the rewrites whose ledger "Green phase" is n, each inside
 * its own describe block titled `upstream/<name>.test.ts`, and ends with the count test:
 *
 * ```ts
 * conformancePhase(2, () => {
 *   describe("upstream/deep.test.ts", upstreamFileOptions(), async () => {
 *     await import("../upstream/deep.test.js")
 *   })
 * })
 * ```
 *
 * `conformancePhase` runs three checks after the imported blocks, the count check last:
 *
 * - The graduation check: each imported rewrite has left `pending.json` and the
 *   `tsconfig.test.green.json` exclude, and the ledger marks it `passes` (SD-1).
 * - The import check reads the evidence file's own source and compares the files it imports
 *   with the green-phase column of the ledger; no other CONF evidence file of its folder
 *   (`*-CONF-<n>.spec.ts`) may import one of them.
 * - The count check walks the Vitest task tree of the evidence file (`task.file`) and, per
 *   imported file, requires `passed >= runnable - notPortedRunnable` and `passed >= 1`, with
 *   no skipped test and no test that has not run yet. `runnable` excludes upstream skip and
 *   todo tests; `notPortedRunnable` counts only "missing" rows of runnable tests, by their
 *   expanded count.
 *
 * The import and count checks pass only once every file of the phase is imported. Until the
 * last one, the per-file import tasks of a phase declare the suite with the graduation check
 * alone, under the same title:
 *
 * ```ts
 * conformanceSuite({ title: conformanceTitle(3), checks: [graduationCheck(3)] }, () => {
 *   describe("upstream/definition.test.ts", upstreamFileOptions(), async () => {
 *     await import("../upstream/definition.test.js")
 *   })
 * })
 * ```
 *
 * Order under `--sequence.shuffle`: `conformanceSuite` wraps the blocks and the checks in a
 * describe block with `shuffle: false`, so its children run in declaration order and the
 * count test runs after every imported block. Each block takes `upstreamFileOptions()`, which
 * gives it the run's own shuffle setting back, so the tests inside a block still shuffle when
 * the run does. The count check also fails when it finds a test that has not run yet.
 *
 * @since 0.1.0
 */
import { assert, describe, it } from "@effect/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import ts from "typescript"
import { type RunnerTestCase, TestRunner } from "vitest"
import type { UpstreamFile } from "../../scripts/upstream/freeze-upstream.js"
import { type LedgerRow, shortName } from "./ledger.js"
import { calleeRoot, notPortedRunnable, PKG_ROOT, readLedger, readManifest } from "./parity.js"

// ---------------------------------------------------------------- names

/**
 * The describe title of the block that imports an upstream file: `upstream/<name>.test.ts`.
 *
 * @since 0.1.0
 */
export const upstreamDescribeTitle = (name: string): string => `upstream/${name}.test.ts`

/**
 * The title of the CONF-n suite: `[CONF-n] upstream files green at phase n`. A per-file
 * import task passes it to `conformanceSuite`, so the suite keeps its title when the closing
 * task of the phase switches to `conformancePhase`.
 *
 * @since 0.1.0
 */
export const conformanceTitle = (phase: number): string => `[CONF-${phase}] upstream files green at phase ${phase}`

const BLOCK_TITLE = /^upstream\/.+\.test\.ts$/
const UPSTREAM_SPECIFIER = /^\.\.\/upstream\//
const UPSTREAM_TEST_SPECIFIER = /^\.\.\/upstream\/(.+)\.test\.js$/
const CONF_EVIDENCE_FILE = /-CONF-\d+\.spec\.ts$/

/**
 * The ledger file rows whose green phase is `phase`.
 *
 * @since 0.1.0
 */
export const greenFiles = (files: ReadonlyArray<LedgerRow>, phase: number): ReadonlyArray<LedgerRow> =>
  files.filter((row) => row["Green phase"] === String(phase))

// ---------------------------------------------------------------- the import check

/**
 * One import of a module of `test/upstream/` by an evidence file.
 *
 * @since 0.1.0
 */
export interface UpstreamImport {
  readonly specifier: string
  /** The short name of the imported upstream test file (`deep`, `examples/cd`), or null. */
  readonly file: string | null
  /** The title of the nearest describe block around the import, or null. */
  readonly describe: string | null
  readonly line: number
}

/**
 * Lists the modules of `test/upstream/` that an evidence file imports (dynamic or static),
 * in source order, with the describe block around each.
 *
 * @since 0.1.0
 */
export const importsOf = (source: string, fileName = "evidence.spec.ts"): ReadonlyArray<UpstreamImport> => {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: Array<UpstreamImport> = []
  const record = (specifier: ts.Expression | undefined, describeTitle: string | null, node: ts.Node): void => {
    if (specifier === undefined || !ts.isStringLiteralLike(specifier) || !UPSTREAM_SPECIFIER.test(specifier.text)) return
    found.push({
      specifier: specifier.text,
      file: UPSTREAM_TEST_SPECIFIER.exec(specifier.text)?.[1] ?? null,
      describe: describeTitle,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    })
  }
  const visit = (node: ts.Node, describeTitle: string | null): void => {
    let title = describeTitle
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier, describeTitle, node)
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) record(node.arguments[0], describeTitle, node)
      const first = node.arguments[0]
      if (calleeRoot(node.expression) === "describe" && first !== undefined && ts.isStringLiteralLike(first)) {
        title = first.text
      }
    }
    ts.forEachChild(node, (child) => visit(child, title))
  }
  visit(sf, null)
  return found
}

/**
 * Compares the upstream files an evidence file imports with the files whose ledger green
 * phase is `phase`. Each problem names the file; an empty list means the imports are exact.
 *
 * @since 0.1.0
 */
export const checkImports = (input: {
  readonly source: string
  readonly phase: number
  readonly files: ReadonlyArray<LedgerRow>
}): ReadonlyArray<string> => {
  const { files, phase, source } = input
  const rows = new Map(files.map((row) => [row["Name"] ?? "", row]))
  const problems: Array<string> = []
  const seen = new Set<string>()
  for (const entry of importsOf(source)) {
    if (entry.file === null) {
      problems.push(`${entry.specifier}: not an upstream test file`)
      continue
    }
    const label = upstreamDescribeTitle(entry.file)
    const row = rows.get(entry.file)
    if (row === undefined) {
      problems.push(`${label}: not in the ledger's upstream file table`)
      continue
    }
    if (seen.has(entry.file)) {
      problems.push(`${label}: imported more than once`)
      continue
    }
    seen.add(entry.file)
    if (entry.describe === null) problems.push(`${label}: its import is not inside a describe block`)
    else if (entry.describe !== label) problems.push(`${label}: its describe block is titled "${entry.describe}"`)
    if (row["Green phase"] !== String(phase)) problems.push(`${label}: green at phase ${row["Green phase"] ?? "?"}, not ${phase}`)
  }
  for (const row of greenFiles(files, phase)) {
    const name = row["Name"] ?? ""
    if (!seen.has(name)) problems.push(`${upstreamDescribeTitle(name)}: green at phase ${phase} but not imported`)
  }
  return problems
}

/**
 * The source of one evidence file, by file name.
 *
 * @since 0.1.0
 */
export interface EvidenceSource {
  readonly file: string
  readonly source: string
}

/** The short names of the upstream test files a source imports, in source order. */
const importedFiles = (source: string, fileName?: string): ReadonlyArray<string> =>
  importsOf(source, fileName).flatMap((entry) => (entry.file === null ? [] : [entry.file]))

/**
 * The CONF evidence files (`*-CONF-<n>.spec.ts`) of a folder with their source, sorted by
 * file name.
 *
 * @since 0.1.0
 */
export const confEvidenceSources = (folder: string): ReadonlyArray<EvidenceSource> =>
  readdirSync(folder)
    .filter((name) => CONF_EVIDENCE_FILE.test(name))
    .sort()
    .map((name) => ({ file: name, source: readFileSync(join(folder, name), "utf8") }))

/**
 * The upstream files of an evidence file that another CONF evidence file also imports, so
 * that their tests would run twice (SD-1). Each problem names the file and the other
 * evidence files; an empty list means no other file imports one of its files.
 *
 * @since 0.1.0
 */
export const checkImportedElsewhere = (input: {
  readonly source: string
  readonly others: ReadonlyArray<EvidenceSource>
}): ReadonlyArray<string> => {
  const { others, source } = input
  return [...new Set(importedFiles(source))].flatMap((name) => {
    const by = others.filter((other) => importedFiles(other.source, other.file).includes(name)).map((other) => other.file)
    return by.length === 0 ? [] : [`${upstreamDescribeTitle(name)}: also imported by ${by.join(" and ")}`]
  })
}

/**
 * The CONF-8 check across evidence files: every upstream file of the ledger is imported by
 * exactly one of them. Problems list the files imported more than once, then the files
 * imported by none, then imports the ledger does not know.
 *
 * @since 0.1.0
 */
export const checkImportedOnce = (
  sources: ReadonlyArray<EvidenceSource>,
  files: ReadonlyArray<LedgerRow>
): ReadonlyArray<string> => {
  const importers = new Map<string, Array<string>>()
  for (const { file, source } of sources) {
    for (const entry of importsOf(source, file)) {
      if (entry.file !== null) importers.set(entry.file, [...(importers.get(entry.file) ?? []), file])
    }
  }
  const names = files.map((row) => row["Name"] ?? "")
  const twice = names.flatMap((name) => {
    const by = importers.get(name) ?? []
    return by.length > 1 ? [`${upstreamDescribeTitle(name)}: imported by ${by.join(" and ")}`] : []
  })
  const never = names.flatMap((name) =>
    importers.has(name) ? [] : [`${upstreamDescribeTitle(name)}: imported by no CONF evidence file`]
  )
  const unknown = [...importers.keys()].filter((name) => !names.includes(name)).map((name) =>
    `${upstreamDescribeTitle(name)}: not in the ledger's upstream file table`
  )
  return [...twice, ...never, ...unknown]
}

// ---------------------------------------------------------------- the count check

/**
 * The part of a Vitest task (`RunnerTestFile`, `RunnerTestSuite`, `RunnerTestCase`) that the
 * count check reads.
 *
 * @since 0.1.0
 */
export interface TaskNode {
  readonly type: string
  readonly name: string
  readonly mode: string
  readonly result?: { readonly state: string } | undefined
  readonly tasks?: ReadonlyArray<TaskNode> | undefined
}

/**
 * The tests of one `upstream/<name>.test.ts` block, by outcome at the time of the count.
 *
 * @since 0.1.0
 */
export interface BlockCount {
  readonly title: string
  readonly passed: number
  readonly failed: number
  /** Tests with mode or state `skip` or `todo`. */
  readonly skipped: number
  /** Tests with no final state yet. */
  readonly notRun: number
}

const testsOf = (node: TaskNode): ReadonlyArray<TaskNode> =>
  node.type === "test" ? [node] : (node.tasks ?? []).flatMap(testsOf)

const isSkipped = (test: TaskNode): boolean =>
  test.mode === "skip" || test.mode === "todo" || test.result?.state === "skip" || test.result?.state === "todo"

const countBlock = (block: TaskNode): BlockCount => {
  const tests = testsOf(block)
  const passed = tests.filter((test) => test.result?.state === "pass").length
  const failed = tests.filter((test) => test.result?.state === "fail").length
  const skipped = tests.filter((test) => test.result?.state !== "pass" && test.result?.state !== "fail" && isSkipped(test)).length
  return { title: block.name, passed, failed, skipped, notRun: tests.length - passed - failed - skipped }
}

/**
 * Counts the tests of every `upstream/<name>.test.ts` describe block of a task tree
 * (nested describe blocks included), in tree order.
 *
 * @since 0.1.0
 */
export const countUpstreamBlocks = (root: TaskNode): ReadonlyArray<BlockCount> => {
  const blocks: Array<BlockCount> = []
  const visit = (node: TaskNode): void => {
    if (node.type !== "test" && BLOCK_TITLE.test(node.name)) {
      blocks.push(countBlock(node))
      return
    }
    for (const child of node.tasks ?? []) visit(child)
  }
  visit(root)
  return blocks
}

/**
 * The passed tests a file must have: its runnable upstream tests minus the runnable tests
 * that "missing" ledger rows leave out.
 *
 * @since 0.1.0
 */
export const requiredPassed = (upstream: UpstreamFile, notPorted: ReadonlyArray<LedgerRow>): number =>
  upstream.runnable - notPortedRunnable(upstream, notPorted)

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`

/**
 * Checks the counted blocks against the expected upstream files (short names). An empty
 * list means every expected file has its block, enough passed tests, at least one passed
 * test, no skipped test and no test still to run, and no other block exists.
 *
 * @since 0.1.0
 */
export const checkCounts = (input: {
  readonly blocks: ReadonlyArray<BlockCount>
  readonly expected: ReadonlyArray<string>
  readonly files: ReadonlyArray<UpstreamFile>
  readonly notPorted: ReadonlyArray<LedgerRow>
}): ReadonlyArray<string> => {
  const { blocks, expected, files, notPorted } = input
  const byName = new Map(files.map((file) => [shortName(file.path), file]))
  const byTitle = new Map(blocks.map((block) => [block.title, block]))
  const problems: Array<string> = []
  for (const name of expected) {
    const label = upstreamDescribeTitle(name)
    const upstream = byName.get(name)
    const block = byTitle.get(label)
    if (upstream === undefined) {
      problems.push(`${label}: not in the inventory`)
      continue
    }
    if (block === undefined) {
      problems.push(`${label}: no describe block in the evidence file`)
      continue
    }
    const left = notPortedRunnable(upstream, notPorted)
    const required = upstream.runnable - left
    if (block.passed < required) {
      problems.push(`${label}: ${block.passed} passed, at least ${required} required (${upstream.runnable} runnable, ${left} not ported)`)
    }
    if (block.passed === 0) problems.push(`${label}: no test passed`)
    if (block.skipped > 0) problems.push(`${label}: ${plural(block.skipped, "skipped or todo test")}`)
    if (block.notRun > 0) problems.push(`${label}: ${plural(block.notRun, "test")} had not run when the count check ran`)
  }
  const titles = new Set(expected.map(upstreamDescribeTitle))
  for (const block of blocks) {
    if (!titles.has(block.title)) problems.push(`${block.title}: not a file of this check`)
  }
  return problems
}

// ---------------------------------------------------------------- the graduation check

/**
 * The graduation problems of the imported rewrites (short names): a rewrite still in
 * `pending.json`, a rewrite still in the green type-check exclude, a ledger file row that is
 * not `passes`. An empty list means every imported rewrite has graduated.
 *
 * @since 0.1.0
 */
export const graduationProblems = (input: {
  readonly files: ReadonlyArray<string>
  readonly pending: ReadonlyArray<string>
  readonly greenExclude: ReadonlyArray<string>
  readonly ledgerFiles: ReadonlyArray<LedgerRow>
}): ReadonlyArray<string> => {
  const { files, greenExclude, ledgerFiles, pending } = input
  if (files.length === 0) return ["the evidence file imports no upstream test file"]
  return files.flatMap((name) => {
    const rewrite = `test/upstream/${name}.test.ts`
    const status = ledgerFiles.find((row) => row["Name"] === name)?.["Status"] ?? "no ledger row"
    return [
      ...(pending.includes(rewrite) ? [`${rewrite}: still listed in test/upstream/pending.json`] : []),
      ...(greenExclude.includes(rewrite) ? [`${rewrite}: still in the tsconfig.test.green.json exclude`] : []),
      ...(status === "passes" ? [] : [`${upstreamDescribeTitle(name)}: ledger status "${status}", not "passes"`])
    ]
  })
}

const readJson = (root: string, relative: string): unknown => JSON.parse(readFileSync(join(root, relative), "utf8"))

/**
 * The graduation check of a CONF-n suite, on the files its evidence file imports (see
 * `graduationProblems`). A per-file import task of a phase runs it alone, as its red (import
 * first, then `add-pending.py --remove` and the ledger status); `conformancePhase` runs it
 * first.
 *
 * @since 0.1.0
 */
export const graduationCheck = (phase: number, root: string = PKG_ROOT): ConformanceCheck => ({
  name: `[CONF-${phase}] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes`,
  check: (task) => {
    const { ledger, problems } = readLedger(root)
    const green = readJson(root, "tsconfig.test.green.json") as { readonly exclude: ReadonlyArray<string> }
    return [
      ...problems,
      ...graduationProblems({
        files: importedFiles(readFileSync(task.file.filepath, "utf8")),
        pending: readJson(root, "test/upstream/pending.json") as ReadonlyArray<string>,
        greenExclude: green.exclude,
        ledgerFiles: ledger.files
      })
    ]
  }
})

// ---------------------------------------------------------------- the evidence suite

/**
 * The options of an imported block: the run's own shuffle setting (`sequence.shuffle`),
 * which the unshuffled CONF suite would otherwise pass down to it.
 *
 * @since 0.1.0
 */
export const upstreamFileOptions = (): { readonly shuffle: boolean } => {
  const file: { readonly shuffle?: boolean | undefined } | undefined = TestRunner.getCurrentSuite().file
  return { shuffle: file?.shuffle === true }
}

/**
 * One test of a CONF suite: it passes when `check` returns no problem.
 *
 * @since 0.1.0
 */
export interface ConformanceCheck {
  readonly name: string
  readonly check: (task: Readonly<RunnerTestCase>) => ReadonlyArray<string>
}

/**
 * Declares a describe block that never shuffles its own children: first the imported blocks
 * that `imports` declares, then the checks, in order. The last check therefore runs after
 * every test of every imported block, also under `--sequence.shuffle`.
 *
 * @since 0.1.0
 */
export const conformanceSuite = (
  suite: { readonly title: string; readonly checks: ReadonlyArray<ConformanceCheck> },
  imports: () => void
): void => {
  describe(suite.title, { shuffle: false }, () => {
    imports()
    for (const { check, name } of suite.checks) {
      it(name, ({ task }) => {
        assert.deepStrictEqual(check(task), [])
      })
    }
  })
}

/**
 * The CONF-n evidence suite: the imported blocks, then the graduation check, the import
 * check (exact imports, none imported by another CONF evidence file of the folder) and the
 * count check (`[CONF-n] every imported file meets its count`), reading the ledger and the
 * inventory of the package folder.
 *
 * @since 0.1.0
 */
export const conformancePhase = (phase: number, imports: () => void, root: string = PKG_ROOT): void =>
  conformanceSuite(
    {
      title: conformanceTitle(phase),
      checks: [
        graduationCheck(phase, root),
        {
          name: `[CONF-${phase}] the evidence file imports exactly the upstream files green at phase ${phase}, and no other CONF evidence file imports them`,
          check: (task) => {
            const { ledger, problems } = readLedger(root)
            const { filepath } = task.file
            const source = readFileSync(filepath, "utf8")
            const others = confEvidenceSources(dirname(filepath)).filter((entry) => entry.file !== basename(filepath))
            return [
              ...problems,
              ...checkImports({ source, phase, files: ledger.files }),
              ...checkImportedElsewhere({ source, others })
            ]
          }
        },
        {
          name: `[CONF-${phase}] every imported file meets its count`,
          check: (task) => {
            const { ledger, problems } = readLedger(root)
            return [
              ...problems,
              ...checkCounts({
                blocks: countUpstreamBlocks(task.file),
                expected: greenFiles(ledger.files, phase).map((row) => row["Name"] ?? ""),
                files: readManifest(root).files,
                notPorted: ledger.notPorted
              })
            ]
          }
        }
      ]
    },
    imports
  )
