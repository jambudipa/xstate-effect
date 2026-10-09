/**
 * SNAP-1: snapshot assertions are not self-confirming.
 *
 * T8.10 (SD-26, D1; AC 30). A snapshot assertion proves nothing when its expected text came
 * from the port itself: an empty `toMatchInlineSnapshot()` that Vitest fills in, a text pasted
 * from a port run, or a snapshot file entry that Vitest wrote. Every expected text must
 * therefore be upstream's, from the frozen manifest `test/upstream/upstream-manifest.json`, or a
 * ledger row must name the difference (for example an `Option` field, D8). The checker reads
 * the sources, the manifest, the ledger and the snapshot files; it never runs the suite.
 *
 * - No `toMatchInlineSnapshot` or `toThrowErrorMatchingInlineSnapshot` call under
 *   `test/upstream/` is empty (no argument, or an argument with no text).
 * - Each inline snapshot under `test/upstream/` sits in an annotated upstream test
 *   (`// upstream: ...`, SD-2) and keeps one upstream inline snapshot of that test: the same
 *   text (as Vitest compares it) under the same matcher. The one other form: where SD-3 turns
 *   upstream's synchronous throw into a failed Effect, the rewrite snapshots the failure,
 *   `expect(yield* Effect.flip(...)).toMatchInlineSnapshot(...)`, with upstream's
 *   `toThrowErrorMatchingInlineSnapshot` text. A text that keeps none is the port's own and
 *   needs an `inline snapshot` row of the "Tests not ported" table that cites a decision (the
 *   row the parity checker reads), and a test has no more own texts than upstream snapshots it
 *   does not keep: a row lets a text replace an upstream one, not add one.
 * - Each of the 3 upstream `toThrowErrorMatchingInlineSnapshot` texts (eventDescriptors,
 *   actorLogic, graph/index) is kept in its rewrite under the same rule, or has that row.
 * - The graph snapshot entries (D1): Vitest reads a file snapshot beside the file it runs, so
 *   the entries of upstream `graph.test.ts.snap` live in the snapshot file of the CONF-n
 *   evidence file of the ledger's green phase of `graph/graph`
 *   (`test/verify/__snapshots__/verify-xstate-5-33-2-port-CONF-7.spec.ts.snap`), each key
 *   prefixed with the describe chain of its import block
 *   (`[CONF-7] upstream files green at phase 7 > upstream/graph/graph.test.ts > `). Each
 *   entry of a snapshot file under `test/verify/__snapshots__` equals an upstream entry under
 *   that prefix, every upstream entry is there, and each file belongs to an evidence file
 *   beside it. An entry that differs, is extra or is missing needs a deviation row whose
 *   Subject names the upstream key in backticks and that cites a decision.
 * - The one snapshot file under `test/` outside `test/verify/__snapshots__` that may exist is
 *   the upstream copy beside the graph rewrite (`test/upstream/graph/__snapshots__/
 *   graph.test.ts.snap`, read by a direct run of the rewrite, T7.19), and it equals byte for
 *   byte the Vitest file of the manifest's upstream entries.
 * - No snapshot is written or updated by the gate (the static half of AC 30): no Vitest config
 *   sets an update option or `UPDATE_SNAPSHOT`, and the `test` and `test:upstream` scripts run
 *   `CI=true vitest run` without `-u`, `--update` or `UPDATE_SNAPSHOT`. With `CI` set and no
 *   update option, Vitest 5 resolves the update mode to "none": a missing snapshot fails the
 *   run instead of being written. The equal key sets above leave no obsolete entry. The
 *   summary of a whole default run (0 written, 0 updated, 0 obsolete) is the final gate's
 *   record (T8.14), not a test here.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import ts from "typescript"
import {
  type InlineSnapshot,
  inlineSnapshotOf,
  parseAnnotation,
  readSnapshotFile,
  type UpstreamManifest,
  type UpstreamTest
} from "../../scripts/upstream/freeze-upstream.js"
import { conformanceTitle, upstreamDescribeTitle } from "./conformance.js"
import { citedDecisions, evidenceFile, type LedgerRow, notPortedAnnotation, rewritePath, shortName } from "./ledger.js"
import { normalizeSnapshot, PKG_ROOT, readLedger, readManifest } from "./parity.js"

const readText = (path: string): string => readFileSync(join(PKG_ROOT, path), "utf8")

/** The folder of the evidence files' file snapshots. */
const VERIFY_SNAPSHOT_DIR = "test/verify/__snapshots__"

const INLINE_MATCHER = "toMatchInlineSnapshot"
const THROW_MATCHER = "toThrowErrorMatchingInlineSnapshot"

/** The first line Vitest writes in a snapshot file. */
const SNAPSHOT_HEADER = "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html"

/** The text Vitest writes for a snapshot file with these entries, in this order. */
const snapshotFileText = (entries: ReadonlyArray<readonly [string, string]>): string =>
  `${SNAPSHOT_HEADER}\n\n${entries.map(([key, value]) => `exports[\`${key}\`] = \`${value}\`;`).join("\n\n")}\n`

/** Every file under a folder of the package whose name passes `keep`, relative to the package folder. */
const filesUnder = (dir: string, keep: (name: string) => boolean): ReadonlyArray<string> =>
  existsSync(join(PKG_ROOT, dir))
    ? readdirSync(join(PKG_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) return filesUnder(path, keep)
        return entry.isFile() && keep(entry.name) ? [path] : []
      })
    : []

const isTypeScript = (name: string): boolean => name.endsWith(".ts")
const isSnapshotFile = (name: string): boolean => name.endsWith(".snap")

/** One inline snapshot call of a source file. */
interface InlineCall {
  readonly file: string
  readonly line: number
  readonly matcher: string
  /** The text between the backticks; null when the call has no argument. */
  readonly text: string | null
  /** True when the call snapshots `yield* Effect.flip(...)`, the failure of an Effect. */
  readonly flippedFailure: boolean
  /** The annotation text (`<key>[ #<n>]`) of the nearest annotated statement around the call, if any. */
  readonly annotation: string | null
}

/** The annotation text directly above a statement (the last leading comment, on the line before it), if any. */
const annotationAbove = (statement: ts.Statement, sf: ts.SourceFile): string | null => {
  const leading = ts.getLeadingCommentRanges(sf.text, statement.pos) ?? []
  const last = leading[leading.length - 1]
  if (last === undefined) return null
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line
  if (lineOf(statement.getStart(sf)) !== lineOf(last.end) + 1) return null
  const parsed = parseAnnotation(sf.text.slice(last.pos, last.end))
  if (parsed === null) return null
  return parsed.occurrence === null ? parsed.key : `${parsed.key} #${parsed.occurrence}`
}

/** True when a snapshot call reads `expect(yield* Effect.flip(...)).<matcher>(...)`. */
const snapshotsFlippedFailure = (call: ts.CallExpression): boolean => {
  const matcher = call.expression
  if (!ts.isPropertyAccessExpression(matcher) || !ts.isCallExpression(matcher.expression)) return false
  const expectCall = matcher.expression
  const subject = expectCall.arguments[0]
  if (!ts.isIdentifier(expectCall.expression) || expectCall.expression.text !== "expect") return false
  if (subject === undefined || !ts.isYieldExpression(subject) || subject.asteriskToken === undefined) return false
  const inner = subject.expression
  return (
    inner !== undefined && ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) &&
    ts.isIdentifier(inner.expression.expression) && inner.expression.expression.text === "Effect" &&
    inner.expression.name.text === "flip"
  )
}

/** Every inline snapshot call of a source file, with the annotation of the test around it. */
const inlineCallsOf = (file: string): ReadonlyArray<InlineCall> => {
  const sf = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const calls: Array<InlineCall> = []
  const visit = (node: ts.Node, annotation: string | null): void => {
    const own = ts.isExpressionStatement(node) ? annotationAbove(node, sf) : null
    const current = own ?? annotation
    const snapshot = inlineSnapshotOf(node, sf)
    if (snapshot !== null && ts.isCallExpression(node)) {
      calls.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        matcher: snapshot.matcher,
        text: snapshot.text,
        flippedFailure: snapshotsFlippedFailure(node),
        annotation: current
      })
    }
    ts.forEachChild(node, (child) => visit(child, current))
  }
  visit(sf, null)
  return calls
}

/** Every inline snapshot call of every TypeScript file under `test/upstream/`. */
const upstreamFolderCalls = Effect.sync(() => filesUnder("test/upstream", isTypeScript).flatMap(inlineCallsOf))

/** True when an inline snapshot gives no expected text. */
const isEmpty = (call: InlineCall): boolean => call.text === null || normalizeSnapshot(call.text) === ""

/** `file:line` of a call. */
const where = (call: InlineCall): string => `${call.file}:${call.line}`

/**
 * True when a rewrite's inline snapshot keeps an upstream one: the same text under the same
 * matcher, or upstream's error text under `toMatchInlineSnapshot` of the flipped failure where
 * SD-3 turns the synchronous throw into a failed Effect.
 */
const keeps = (call: InlineCall, upstream: InlineSnapshot): boolean =>
  normalizeSnapshot(call.text) === normalizeSnapshot(upstream.text) &&
  (call.matcher === upstream.matcher ||
    (upstream.matcher === THROW_MATCHER && call.matcher === INLINE_MATCHER && call.flippedFailure))

/** The upstream tests of the manifest, by annotation text (trimmed, as the parity checker reads them). */
const testsByAnnotation = (manifest: UpstreamManifest): ReadonlyMap<string, UpstreamTest> =>
  new Map(manifest.files.flatMap((file) => file.tests.map((test) => [test.annotation.trimEnd(), test] as const)))

/** The annotations of the "Tests not ported" `inline snapshot` rows that cite a decision. */
const inlineSnapshotRows = (notPorted: ReadonlyArray<LedgerRow>): ReadonlySet<string> =>
  new Set(
    notPorted
      .filter((row) => row["Gap kind"] === "inline snapshot" && citedDecisions(row["Reason"] ?? "").length > 0)
      .map(notPortedAnnotation)
  )

/** True when a deviation row names an upstream snapshot key in backticks in its Subject and cites a decision. */
const excusedByDeviation = (deviations: ReadonlyArray<LedgerRow>) => (key: string): boolean =>
  deviations.some((row) =>
    row["Kind"] === "deviation" && (row["Subject"] ?? "").includes(`\`${key}\``) &&
    citedDecisions(row["Decision"] ?? "").length > 0
  )

/** The upstream test file of an upstream snapshot file: `<dir>/__snapshots__/<name>.snap` → `<dir>/<name>`. */
const testFileOfSnapshot = (snapshotFile: string): string =>
  snapshotFile.replace("/__snapshots__/", "/").replace(/\.snap$/, "")

/** Where a direct run of a rewrite reads its file snapshots: `__snapshots__/<rewrite name>.snap` beside it. */
const rewriteSnapshotPath = (upstreamTestFile: string): string => {
  const rewrite = rewritePath(upstreamTestFile)
  return `${posix.dirname(rewrite)}/__snapshots__/${posix.basename(rewrite)}.snap`
}

/** The upstream entries one snapshot file of the evidence files must hold, under the key prefix of their import block. */
interface EvidenceSnapshot {
  readonly path: string
  readonly prefix: string
  readonly entries: ReadonlyMap<string, string>
}

/**
 * The evidence snapshot file of each upstream snapshot file: the one of the CONF-n evidence
 * file of the ledger's green phase of its test file, keys prefixed with the CONF-n suite
 * title and the import block's title. Problems name an upstream snapshot file whose test has
 * no green phase.
 */
const evidenceSnapshots = (
  manifest: UpstreamManifest,
  files: ReadonlyArray<LedgerRow>
): { readonly snapshots: ReadonlyArray<EvidenceSnapshot>; readonly problems: ReadonlyArray<string> } => {
  const snapshots: Array<EvidenceSnapshot> = []
  const problems: Array<string> = []
  for (const [snapshotFile, entries] of Object.entries(manifest.graphSnapshots)) {
    const testFile = testFileOfSnapshot(snapshotFile)
    const phase = Number(files.find((row) => row["Upstream file"] === testFile)?.["Green phase"])
    if (!Number.isInteger(phase)) {
      problems.push(`${snapshotFile}: the ledger gives ${testFile} no green phase`)
      continue
    }
    snapshots.push({
      path: `${VERIFY_SNAPSHOT_DIR}/${posix.basename(evidenceFile(`CONF-${phase}`))}.snap`,
      prefix: `${conformanceTitle(phase)} > ${upstreamDescribeTitle(shortName(testFile))} > `,
      entries: new Map(Object.entries(entries))
    })
  }
  return { snapshots, problems }
}

describe("SNAP-1 Snapshot assertions are not self-confirming", () => {
  it.effect("[SNAP-1] no toMatchInlineSnapshot call in test/upstream/ is empty", () =>
    Effect.gen(function* () {
      const calls = yield* upstreamFolderCalls
      assert.isAbove(calls.length, 0, "the scan finds the rewrites' inline snapshots")
      assert.deepStrictEqual(calls.filter((call) => call.matcher === INLINE_MATCHER && isEmpty(call)).map(where), [])
    }))

  it.effect("[SNAP-1] no toThrowErrorMatchingInlineSnapshot call in test/upstream/ is empty", () =>
    Effect.gen(function* () {
      const calls = yield* upstreamFolderCalls
      // SD-3 (amended 2026-10-08): no port operation throws, so the rewrites snapshot each
      // upstream error as the failure of an Effect (`yield* Effect.flip(...)`)
      assert.isAbove(calls.filter((call) => call.flippedFailure).length, 0)
      assert.deepStrictEqual(calls.filter((call) => call.matcher === THROW_MATCHER && isEmpty(call)).map(where), [])
    }))

  it.effect("[SNAP-1] each inline snapshot in test/upstream/ keeps an upstream inline snapshot of its annotated test, or replaces one that the test does not keep under an inline snapshot ledger row", () =>
    Effect.gen(function* () {
      const manifest = readManifest()
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const tests = testsByAnnotation(manifest)
      const excused = inlineSnapshotRows(ledger.notPorted)
      const calls = yield* upstreamFolderCalls
      const faults: Array<string> = calls
        .filter((call) => call.annotation === null)
        .map((call) => `${where(call)}: ${call.matcher} outside an annotated upstream test`)
      const byTest = new Map<string, Array<InlineCall>>()
      for (const call of calls) {
        if (call.annotation !== null) byTest.set(call.annotation, [...(byTest.get(call.annotation) ?? []), call])
      }
      for (const [annotation, own] of byTest) {
        const test = tests.get(annotation)
        if (test === undefined) {
          faults.push(...own.map((call) => `${where(call)}: the annotation "${annotation}" names no upstream test`))
          continue
        }
        const notKept = [...test.inlineSnapshots]
        const ownTexts = own.filter((call) => {
          const index = notKept.findIndex((upstream) => keeps(call, upstream))
          if (index < 0) return true
          notKept.splice(index, 1)
          return false
        })
        if (ownTexts.length === 0) continue
        if (!excused.has(annotation)) {
          faults.push(
            ...ownTexts.map((call) => `${where(call)}: ${call.matcher} keeps no upstream snapshot of "${annotation}" and the test has no inline snapshot row`)
          )
        } else if (ownTexts.length > notKept.length) {
          faults.push(
            `${annotation}: ${ownTexts.length} own snapshot texts (${ownTexts.map(where).join(", ")}) for ${notKept.length} upstream snapshots not kept`
          )
        }
      }
      assert.isAbove(byTest.size, 0)
      assert.deepStrictEqual(faults, [])
    }))

  it.effect("[SNAP-1] each of the 3 upstream toThrowErrorMatchingInlineSnapshot texts (eventDescriptors, actorLogic, graph/index) is kept in its rewrite, or has an inline snapshot ledger row", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      const { ledger } = readLedger()
      const excused = inlineSnapshotRows(ledger.notPorted)
      const upstreamThrows = manifest.files.flatMap((file) =>
        file.tests.flatMap((test) =>
          test.inlineSnapshots
            .filter((snapshot) => snapshot.matcher === THROW_MATCHER)
            .map((snapshot) => ({ file: file.path, annotation: test.annotation.trimEnd(), snapshot }))
        )
      )
      assert.deepStrictEqual(upstreamThrows.map((entry) => entry.file).sort(), [
        "src/graph/test/index.test.ts",
        "test/actorLogic.test.ts",
        "test/eventDescriptors.test.ts"
      ])
      const faults = upstreamThrows.flatMap((entry): ReadonlyArray<string> => {
        if (excused.has(entry.annotation)) return []
        const rewrite = rewritePath(entry.file)
        if (!existsSync(join(PKG_ROOT, rewrite))) return [`${rewrite}: no rewrite for "${entry.annotation}"`]
        const kept = inlineCallsOf(rewrite).some((call) => call.annotation === entry.annotation && keeps(call, entry.snapshot))
        return kept ? [] : [`${rewrite}: "${entry.annotation}" does not keep the upstream error snapshot and has no ledger row`]
      })
      assert.deepStrictEqual(faults, [])
    }))

  it.effect("[SNAP-1] each entry of the CONF-7 graph snapshot file equals an upstream graph.test.ts.snap entry under its CONF-7 key prefix, every upstream entry is there, and no other snapshot file of the evidence files holds an entry, unless a deviation row names the key", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      const { ledger } = readLedger()
      const excused = excusedByDeviation(ledger.deviations)
      const { problems, snapshots } = evidenceSnapshots(manifest, ledger.files)
      assert.deepStrictEqual(problems, [])
      assert.deepStrictEqual(
        snapshots.map((snapshot) => [snapshot.path, snapshot.prefix, snapshot.entries.size]),
        [[
          `${VERIFY_SNAPSHOT_DIR}/verify-xstate-5-33-2-port-CONF-7.spec.ts.snap`,
          "[CONF-7] upstream files green at phase 7 > upstream/graph/graph.test.ts > ",
          10
        ]],
        "the manifest's 10 upstream graph entries belong in the CONF-7 snapshot file"
      )

      const present = filesUnder(VERIFY_SNAPSHOT_DIR, isSnapshotFile)
      const faults: Array<string> = present
        .filter((file) => !existsSync(join(PKG_ROOT, testFileOfSnapshot(file))))
        .map((file) => `${file}: no evidence file ${testFileOfSnapshot(file)} beside it (an obsolete snapshot file)`)
      for (const file of new Set([...present, ...snapshots.map((snapshot) => snapshot.path)])) {
        const expected = snapshots.find((snapshot) => snapshot.path === file)
        const prefix = expected?.prefix ?? null
        const upstream = expected?.entries ?? new Map<string, string>()
        const actual = existsSync(join(PKG_ROOT, file)) ? readSnapshotFile(join(PKG_ROOT, file), file) : {}
        const seen = new Set<string>()
        for (const [key, value] of Object.entries(actual)) {
          const upstreamKey = prefix !== null && key.startsWith(prefix) ? key.slice(prefix.length) : key
          const upstreamValue = prefix !== null && key.startsWith(prefix) ? upstream.get(upstreamKey) : undefined
          seen.add(upstreamKey)
          if (upstreamValue === undefined) {
            if (!excused(upstreamKey)) faults.push(`${file}: "${key}" is no upstream entry under "${prefix ?? ""}" and has no deviation row`)
          } else if (value !== upstreamValue && !excused(upstreamKey)) {
            faults.push(`${file}: "${key}" differs from the upstream entry and has no deviation row`)
          }
        }
        for (const key of upstream.keys()) {
          if (!seen.has(key) && !excused(key)) faults.push(`${file}: the upstream entry "${key}" is missing and has no deviation row`)
        }
      }
      assert.deepStrictEqual(faults, [])
    }))

  it.effect("[SNAP-1] the only snapshot file under test/ outside test/verify/__snapshots__ is the upstream graph.test.ts.snap copy beside the graph rewrite, byte for byte", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      const copies = new Map(
        Object.entries(manifest.graphSnapshots).map(([snapshotFile, entries]) =>
          [rewriteSnapshotPath(testFileOfSnapshot(snapshotFile)), snapshotFileText(Object.entries(entries))] as const
        )
      )
      assert.deepStrictEqual([...copies.keys()], ["test/upstream/graph/__snapshots__/graph.test.ts.snap"])
      const faults = filesUnder("test", isSnapshotFile)
        .filter((file) => !file.startsWith(`${VERIFY_SNAPSHOT_DIR}/`))
        .flatMap((file): ReadonlyArray<string> => {
          const upstream = copies.get(file)
          if (upstream === undefined) return [`${file}: a snapshot file that is no upstream copy`]
          return readText(file) === upstream ? [] : [`${file}: not byte-identical to the upstream snapshot file`]
        })
      assert.deepStrictEqual(faults, [])
    }))

  it.effect("[SNAP-1] no Vitest config sets snapshot update mode, and the gate scripts run with CI=true and without -u, --update or UPDATE_SNAPSHOT", () =>
    Effect.sync(() => {
      const configs = readdirSync(PKG_ROOT).filter((name) => /^vitest\..*config\.[cm]?[jt]s$/.test(name))
      assert.includeMembers(configs, ["vitest.config.ts", "vitest.upstream.config.ts"])
      for (const config of configs) {
        const text = readText(config)
        const sf = ts.createSourceFile(config, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        const updateKeys: Array<string> = []
        const visit = (node: ts.Node): void => {
          if (
            (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            ["update", "updateSnapshot"].includes(node.name.text)
          ) {
            updateKeys.push(node.name.text)
          }
          ts.forEachChild(node, visit)
        }
        visit(sf)
        assert.deepStrictEqual(updateKeys, [], `${config} sets no snapshot update option`)
        assert.notInclude(text, "UPDATE_SNAPSHOT", `${config} sets no UPDATE_SNAPSHOT`)
      }

      const { scripts } = JSON.parse(readText("package.json")) as { readonly scripts: Readonly<Record<string, string>> }
      const updates = /(^|\s)(-u|--update)(\s|=|$)|UPDATE_SNAPSHOT/
      for (const name of ["test", "test:upstream"]) {
        const script = scripts[name] ?? ""
        assert.match(script, /^CI=true vitest run(\s|$)/, `${name} runs with CI=true`)
      }
      assert.deepStrictEqual(
        Object.entries(scripts).filter(([, script]) => /\bvitest\b/.test(script) && updates.test(script)),
        [],
        "no script updates snapshots"
      )
    }))
})
