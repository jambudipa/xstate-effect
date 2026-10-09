/**
 * The parity checker of SD-2 (scenarios PARITY-2..8, HARNESS-1).
 *
 * A rewrite of an upstream test file is in parity with the frozen inventory
 * `test/upstream/upstream-manifest.json` when every upstream test has an annotated
 * counterpart, or a "Tests not ported" row in the ledger `test/upstream/CONFORMANCE.md`:
 *
 * - The annotation is a line comment `// upstream: <file> > <describe path> > <title>[ #<n>]`
 *   on the line directly above a test call (`it`, `test`, `it.effect`, `it.each(...)(...)`)
 *   or a generator call (`testAll(...)`, a loop, an alias). Its text equals the inventory's
 *   `annotation` field; `parseAnnotation` of the freeze script reads it.
 * - The counterpart (the annotated statement) has at least the upstream number of assertions,
 *   keeps each upstream inline snapshot text (indentation-normalised), and has at least the
 *   upstream number of `@ts-expect-error` lines of the test.
 *
 * Every count is syntactic, from the TypeScript AST, so text in comments and string literals
 * never counts. An assertion is a call `expect(...)`, `assert(...)` or `assert.<name>(...)`;
 * a directive is a comment that TypeScript reads as `@ts-expect-error`. A generator call to
 * a function declared in the rewrite or imported from a relative module also counts the
 * assertions of that function's body, because upstream counts the assertions of its
 * generator helper (`testAll`). A generator annotation stands for all the tests it expands to
 * (`expandedCount`).
 *
 * A ledger row excuses only the gap kind it names. A row for a test that has no such gap is a
 * "stale ledger row" gap, and a row for a test the upstream file does not have is an "unknown
 * ledger row" gap, so the ledger stays exact (D2).
 *
 * @since 0.1.0
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import {
  commentRanges,
  inlineSnapshotOf,
  isTsExpectErrorDirective,
  parseAnnotation,
  type UpstreamFile,
  type UpstreamManifest,
  type UpstreamTest
} from "../../scripts/upstream/freeze-upstream.js"
import {
  describePathOf,
  type GAP_KINDS,
  LEDGER_FILE,
  type LedgerRow,
  notPortedAnnotation,
  type ParsedLedger,
  parseLedger,
  shortName
} from "./ledger.js"

// ---------------------------------------------------------------- layout

/**
 * The package folder `packages/core`.
 *
 * @since 0.1.0
 */
export const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/**
 * The frozen inventory, relative to the package folder.
 *
 * @since 0.1.0
 */
export const MANIFEST_FILE = "test/upstream/upstream-manifest.json"

/**
 * The folder of the rewrites, relative to the package folder.
 *
 * @since 0.1.0
 */
export const UPSTREAM_DIR = "test/upstream"

/**
 * Files of `test/upstream/` that are not rewrites of upstream test files: the ported helpers,
 * the export-parity test and its types (paths relative to `test/upstream/`).
 *
 * @since 0.1.0
 */
export const NON_TEST_FILES: ReadonlyArray<string> = [
  "utils.ts",
  "trackEntries.ts",
  "graph/testUtils.ts",
  "exports.test.ts",
  "exports.types.ts"
]

/**
 * Folders of `test/upstream/` whose files are never rewrites: the SCXML support code and
 * test fixtures.
 *
 * @since 0.1.0
 */
export const NON_TEST_FOLDERS: ReadonlyArray<string> = ["support/", "fixtures/"]

/**
 * True for a file of `test/upstream/` (path relative to that folder) that the parity check
 * and the CONF-8 file count skip.
 *
 * @since 0.1.0
 */
export const isNonTestFile = (relative: string): boolean =>
  NON_TEST_FILES.includes(relative) || NON_TEST_FOLDERS.some((folder) => relative.startsWith(folder))

const compareCodePoints = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const walkTypeScriptFiles = (dir: string, prefix: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) return walkTypeScriptFiles(join(dir, entry.name), relative)
    return entry.isFile() && entry.name.endsWith(".ts") ? [relative] : []
  })

/**
 * The TypeScript files of a rewrite folder, relative to it and in code-point order, without
 * the non-test files. Each one must be the rewrite of an upstream test file.
 *
 * @since 0.1.0
 */
export const listRewriteFiles = (upstreamDir: string): ReadonlyArray<string> =>
  existsSync(upstreamDir)
    ? walkTypeScriptFiles(upstreamDir, "").filter((relative) => !isNonTestFile(relative)).sort(compareCodePoints)
    : []

/**
 * The listed rewrite files (relative to `test/upstream/`) that rewrite no upstream test file.
 *
 * @since 0.1.0
 */
export const unknownRewriteFiles = (
  listed: ReadonlyArray<string>,
  files: ReadonlyArray<UpstreamFile>
): ReadonlyArray<string> => {
  const known = new Set(files.map((file) => `${shortName(file.path)}.test.ts`))
  return listed.filter((relative) => !known.has(relative))
}

// ---------------------------------------------------------------- reading

/**
 * Reads the frozen inventory of a package folder.
 *
 * @since 0.1.0
 */
export const readManifest = (root: string = PKG_ROOT): UpstreamManifest =>
  JSON.parse(readFileSync(join(root, MANIFEST_FILE), "utf8")) as UpstreamManifest

/**
 * Reads and parses the ledger of a package folder.
 *
 * @since 0.1.0
 */
export const readLedger = (root: string = PKG_ROOT): ParsedLedger => parseLedger(readFileSync(join(root, LEDGER_FILE), "utf8"))

const readTextIn = (root: string) => (relative: string): string | null => {
  const absolute = join(root, relative)
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null
}

// ---------------------------------------------------------------- gaps

/**
 * The kinds of gap a "Tests not ported" row can excuse.
 *
 * @since 0.1.0
 */
export type LedgerGapKind = (typeof GAP_KINDS)[number]

/**
 * The kind of a parity gap: a ledger gap kind, or a fault of an annotation or a ledger row.
 *
 * @since 0.1.0
 */
export type ParityGapKind =
  | LedgerGapKind
  | "unknown annotation"
  | "dangling annotation"
  | "duplicate annotation"
  | "stale ledger row"
  | "unknown ledger row"

/**
 * One parity gap, with the upstream test (or annotation text) it is about.
 *
 * @since 0.1.0
 */
export interface ParityGap {
  /** The upstream test file. */
  readonly file: string
  readonly kind: ParityGapKind
  /** The annotation text of the upstream test, or the text of the faulty annotation or row. */
  readonly annotation: string
  readonly describePath: ReadonlyArray<string>
  /** The upstream title (with no occurrence suffix). */
  readonly title: string
  /** The 1-based line in the rewrite, when the gap points at one. */
  readonly line: number | null
  readonly detail: string
}

/**
 * The parity of one rewrite. `runnable`, `annotatedRunnable` and `notPortedRunnable` count
 * expanded tests: a generator annotation counts every test its generator expands to.
 *
 * @since 0.1.0
 */
export interface ParityReport {
  readonly file: string
  readonly rewritePath: string
  readonly gaps: ReadonlyArray<ParityGap>
  readonly runnable: number
  readonly annotatedRunnable: number
  readonly notPortedRunnable: number
}

/**
 * One line of text for a gap.
 *
 * @since 0.1.0
 */
export const formatGap = (gap: ParityGap): string =>
  `${gap.kind}: ${gap.annotation}${gap.line === null ? "" : ` (line ${gap.line})`}: ${gap.detail}`

const RUNNABLE_KINDS: ReadonlySet<string> = new Set(["it", "it.each", "generated"])

const isRunnable = (test: UpstreamTest): boolean => RUNNABLE_KINDS.has(test.kind)

const rowsOf = (upstream: UpstreamFile, notPorted: ReadonlyArray<LedgerRow>): ReadonlyArray<LedgerRow> =>
  notPorted.filter((row) => row["File"] === upstream.path)

/**
 * The runnable upstream tests of a file that a "missing" ledger row leaves out, counted by
 * expanded tests. Rows for upstream skip and todo tests never count: those tests are not
 * runnable.
 *
 * @since 0.1.0
 */
export const notPortedRunnable = (upstream: UpstreamFile, notPorted: ReadonlyArray<LedgerRow>): number => {
  const missing = new Set(
    rowsOf(upstream, notPorted).filter((row) => row["Gap kind"] === "missing").map(notPortedAnnotation)
  )
  return upstream.tests
    .filter((test) => isRunnable(test) && missing.has(test.annotation))
    .reduce((total, test) => total + test.expandedCount, 0)
}

// ---------------------------------------------------------------- the rewrite's syntax

const TEST_ROOTS: ReadonlySet<string> = new Set(["it", "test"])
const NOT_A_TARGET: ReadonlySet<string> = new Set([
  "describe", "suite", "expect", "assert", "vi", "beforeAll", "beforeEach", "afterAll", "afterEach"
])

const lineAt = (sf: ts.SourceFile, pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1

/**
 * The identifier at the root of a callee: `it` for `it.effect.each(table)`, `paths` for
 * `paths.forEach`, `describe` for `describe.sequential`; null when the root is no identifier.
 *
 * @since 0.1.0
 */
export const calleeRoot = (callee: ts.Expression): string | null => {
  let node: ts.Expression = callee
  for (;;) {
    if (ts.isIdentifier(node)) return node.text
    if (
      ts.isPropertyAccessExpression(node) || ts.isCallExpression(node) || ts.isElementAccessExpression(node) ||
      ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)
    ) {
      node = node.expression
    } else {
      return null
    }
  }
}

/** The call of an expression statement (`it(...)`, `await testAll(...)`), if it is one. */
const statementCall = (statement: ts.ExpressionStatement): ts.CallExpression | null => {
  let expression: ts.Expression = statement.expression
  while (ts.isAwaitExpression(expression) || ts.isVoidExpression(expression) || ts.isParenthesizedExpression(expression)) {
    expression = expression.expression
  }
  return ts.isCallExpression(expression) ? expression : null
}

type Target = "test" | "generator"

const targetOf = (call: ts.CallExpression): Target | null => {
  const root = calleeRoot(call.expression)
  if (root === null || NOT_A_TARGET.has(root)) return null
  return TEST_ROOTS.has(root) ? "test" : "generator"
}

/** A test or generator call that an annotation sits directly above. */
interface Annotated {
  readonly statement: ts.ExpressionStatement
  readonly call: ts.CallExpression
  readonly target: Target
}

interface Annotation {
  /** The annotation text: the key plus ` #<n>` when it has an occurrence index. */
  readonly text: string
  readonly line: number
  /** Null when the annotation is not directly above a test or generator call. */
  readonly annotated: Annotated | null
}

/** Every annotation comment of a rewrite, in source order, with the call it annotates. */
const scanAnnotations = (sf: ts.SourceFile): ReadonlyArray<Annotation> => {
  const attached = new Map<number, { readonly statement: ts.ExpressionStatement; readonly call: ts.CallExpression }>()
  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node)) {
      const leading = ts.getLeadingCommentRanges(sf.text, node.pos) ?? []
      const last = leading[leading.length - 1]
      const call = statementCall(node)
      if (
        last !== undefined && call !== null &&
        parseAnnotation(sf.text.slice(last.pos, last.end)) !== null &&
        lineAt(sf, node.getStart(sf)) === lineAt(sf, last.end) + 1
      ) {
        attached.set(last.pos, { statement: node, call })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return commentRanges(sf).flatMap((range) => {
    const parsed = parseAnnotation(range.text)
    if (parsed === null) return []
    const text = parsed.occurrence === null ? parsed.key : `${parsed.key} #${parsed.occurrence}`
    const found = attached.get(range.pos)
    const target = found === undefined ? null : targetOf(found.call)
    const annotated = found === undefined || target === null ? null : { ...found, target }
    return [{ text, line: lineAt(sf, range.pos), annotated }]
  })
}

const isAssertionCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text === "expect" || callee.text === "assert"
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "assert"
}

const countAssertions = (root: ts.Node): number => {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (isAssertionCall(node)) count += 1
    ts.forEachChild(node, visit)
  }
  visit(root)
  return count
}

const inlineSnapshotsIn = (root: ts.Node, sf: ts.SourceFile): ReadonlyArray<string | null> => {
  const texts: Array<string | null> = []
  const visit = (node: ts.Node): void => {
    const snapshot = inlineSnapshotOf(node, sf)
    if (snapshot !== null) texts.push(snapshot.text)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return texts
}

/**
 * The text of an inline snapshot as Vitest compares it: no trailing spaces, no leading or
 * trailing blank line, and the common indentation removed.
 *
 * @since 0.1.0
 */
export const normalizeSnapshot = (text: string | null): string => {
  const lines = (text ?? "").split("\n").map((line) => line.trimEnd())
  while (lines.length > 0 && lines[0] === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const indents = lines.filter((line) => line !== "").map((line) => line.length - line.trimStart().length)
  const indent = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map((line) => line.slice(indent)).join("\n")
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

/** A function declared at the top level of a module: `function name` or `const name = () => ...`. */
const topLevelFunction = (sf: ts.SourceFile, name: string): FunctionNode | null => {
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (
          ts.isIdentifier(declaration.name) && declaration.name.text === name && init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          return init
        }
      }
    }
  }
  return null
}

/** The module paths (relative to the package folder) that a relative import may name. */
const moduleCandidates = (fromPath: string, specifier: string): ReadonlyArray<string> => {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier))
  return [base.replace(/\.js$/, ".ts"), `${base}.ts`, posix.join(base, "index.ts"), base]
}

/**
 * The assertions in the body of the generator a call names: a function of the rewrite, or
 * a function imported from a relative module. Zero when the function cannot be found.
 */
const generatorBodyAssertions = (
  call: ts.CallExpression,
  sf: ts.SourceFile,
  rewritePath: string,
  readModule: (path: string) => string | null
): number => {
  if (!ts.isIdentifier(call.expression)) return 0
  const name = call.expression.text
  const local = topLevelFunction(sf, name)
  if (local !== null) return countAssertions(local)
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    const element = bindings.elements.find((candidate) => candidate.name.text === name)
    if (element === undefined || !statement.moduleSpecifier.text.startsWith(".")) continue
    for (const candidate of moduleCandidates(rewritePath, statement.moduleSpecifier.text)) {
      const text = readModule(candidate)
      if (text === null) continue
      const helperSf = ts.createSourceFile(candidate, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const helper = topLevelFunction(helperSf, element.propertyName?.text ?? name)
      return helper === null ? 0 : countAssertions(helper)
    }
    return 0
  }
  return 0
}

interface Counterpart {
  readonly assertions: number
  readonly inlineSnapshots: ReadonlyArray<string | null>
  readonly directives: number
}

const measure = (
  annotated: Annotated,
  sf: ts.SourceFile,
  directivePositions: ReadonlyArray<number>,
  rewritePath: string,
  readModule: (path: string) => string | null
): Counterpart => {
  const { call, statement, target } = annotated
  const start = statement.getStart(sf)
  const helperAssertions = target === "generator" ? generatorBodyAssertions(call, sf, rewritePath, readModule) : 0
  return {
    assertions: countAssertions(statement) + helperAssertions,
    inlineSnapshots: inlineSnapshotsIn(statement, sf),
    directives: directivePositions.filter((pos) => pos >= start && pos < statement.end).length
  }
}

// ---------------------------------------------------------------- the check

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`

const quotedKind = (kind: string): string => `${/^[aeiou]/.test(kind) ? "an" : "a"} '${kind}'`

/** The gaps of a counterpart against its upstream test, in the order of `GAP_KINDS`. */
const shortfalls = (test: UpstreamTest, counterpart: Counterpart): ReadonlyArray<readonly [LedgerGapKind, string]> => {
  const found: Array<readonly [LedgerGapKind, string]> = []
  if (counterpart.assertions < test.assertionCount) {
    found.push(["assertions", `${plural(counterpart.assertions, "assertion")}, upstream has ${test.assertionCount}`])
  }
  const pool = counterpart.inlineSnapshots.map(normalizeSnapshot)
  const lost = test.inlineSnapshots.filter((snapshot) => {
    const index = pool.indexOf(normalizeSnapshot(snapshot.text))
    if (index < 0) return true
    pool.splice(index, 1)
    return false
  }).length
  if (lost > 0) {
    found.push([
      "inline snapshot",
      `${lost} of ${plural(test.inlineSnapshots.length, "upstream inline snapshot")} not kept`
    ])
  }
  if (counterpart.directives < test.tsExpectErrorCount) {
    found.push([
      "ts-expect-error",
      `${plural(counterpart.directives, "@ts-expect-error line")}, upstream has ${test.tsExpectErrorCount}`
    ])
  }
  return found
}

const titleOfAnnotation = (text: string): { readonly describePath: ReadonlyArray<string>; readonly title: string } => {
  const parsed = parseAnnotation(`// upstream: ${text}`)
  const segments = (parsed?.key ?? text).split(" > ")
  return { describePath: segments.slice(1, -1), title: segments[segments.length - 1] ?? "" }
}

/**
 * The input of the parity check of one rewrite.
 *
 * @since 0.1.0
 */
export interface RewriteInput {
  /** The inventory entry of the upstream test file. */
  readonly upstream: UpstreamFile
  /** The rewrite's path relative to the package folder (`test/upstream/<name>.test.ts`). */
  readonly rewritePath: string
  /** The rewrite's text, or null when the rewrite file does not exist. */
  readonly source: string | null
  /** The "Tests not ported" rows of the ledger (rows of other files are ignored). */
  readonly notPorted: ReadonlyArray<LedgerRow>
  /** Reads a module of the package folder (for generator helpers); null when it is absent. */
  readonly readModule?: (path: string) => string | null
}

/**
 * Checks one rewrite against its upstream inventory entry and the ledger. The gaps come in
 * this order: per upstream test in inventory order, its own gaps and then its stale ledger
 * rows; then the unknown ledger rows; then the annotation faults in source order.
 *
 * @since 0.1.0
 */
export const checkRewrite = (input: RewriteInput): ParityReport => {
  const { notPorted, rewritePath, source } = input
  // An annotation comment cannot end in whitespace, so an upstream title that does is matched trimmed.
  const upstream: UpstreamFile = {
    ...input.upstream,
    tests: input.upstream.tests.map((test) => ({ ...test, annotation: test.annotation.trimEnd() }))
  }
  const readModule = input.readModule ?? ((): string | null => null)
  const file = upstream.path
  const byAnnotation = new Map(upstream.tests.map((test) => [test.annotation, test]))
  const counterparts = new Map<string, Counterpart>()
  const annotationGaps: Array<ParityGap> = []

  if (source !== null) {
    const sf = ts.createSourceFile(rewritePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const directivePositions = commentRanges(sf)
      .filter((range) => isTsExpectErrorDirective(range.text))
      .map((range) => range.pos)
    for (const annotation of scanAnnotations(sf)) {
      const gap = (kind: ParityGapKind, detail: string): ParityGap => ({
        file,
        kind,
        annotation: annotation.text,
        ...titleOfAnnotation(annotation.text),
        line: annotation.line,
        detail
      })
      if (annotation.annotated === null) {
        annotationGaps.push(gap("dangling annotation", "not on the line directly above a test or generator call"))
      } else if (!byAnnotation.has(annotation.text)) {
        annotationGaps.push(gap("unknown annotation", `no upstream test of ${file} has this annotation`))
      } else if (counterparts.has(annotation.text)) {
        annotationGaps.push(gap("duplicate annotation", "another test or generator call already has this annotation"))
      } else {
        counterparts.set(annotation.text, measure(annotation.annotated, sf, directivePositions, rewritePath, readModule))
      }
    }
  }

  const rows = rowsOf(upstream, notPorted)
  const rowKinds = new Map<string, Array<string>>()
  for (const row of rows) {
    const key = notPortedAnnotation(row)
    rowKinds.set(key, [...(rowKinds.get(key) ?? []), row["Gap kind"] ?? ""])
  }

  const testGaps = upstream.tests.flatMap((test): ReadonlyArray<ParityGap> => {
    const counterpart = counterparts.get(test.annotation)
    const found: ReadonlyArray<readonly [LedgerGapKind, string]> = counterpart === undefined
      ? [["missing", "no annotated counterpart and no 'Tests not ported' row"]]
      : shortfalls(test, counterpart)
    const kinds = rowKinds.get(test.annotation) ?? []
    const gap = (kind: ParityGapKind, detail: string): ParityGap => ({
      file,
      kind,
      annotation: test.annotation,
      describePath: test.describePath,
      title: test.title,
      line: null,
      detail
    })
    const open = found.filter(([kind]) => !kinds.includes(kind)).map(([kind, detail]) => gap(kind, detail))
    const stale = kinds.filter((kind) => !found.some(([foundKind]) => foundKind === kind)).map((kind) =>
      gap(
        "stale ledger row",
        kind === "missing"
          ? `${quotedKind(kind)} row, but the test has an annotated counterpart`
          : counterpart === undefined
          ? `${quotedKind(kind)} row, but the test has no annotated counterpart`
          : `${quotedKind(kind)} row, but the counterpart has no such gap`
      )
    )
    return [...open, ...stale]
  })

  const unknownRows = rows.filter((row) => !byAnnotation.has(notPortedAnnotation(row))).map((row): ParityGap => ({
    file,
    kind: "unknown ledger row",
    annotation: notPortedAnnotation(row),
    describePath: describePathOf(row),
    title: row["Title"] ?? "",
    line: null,
    detail: `${quotedKind(row["Gap kind"] ?? "")} row for a test the upstream file does not have`
  }))

  const runnable = upstream.tests.filter(isRunnable)
  const expanded = (tests: ReadonlyArray<UpstreamTest>): number => tests.reduce((total, test) => total + test.expandedCount, 0)
  return {
    file,
    rewritePath,
    gaps: [...testGaps, ...unknownRows, ...annotationGaps],
    runnable: expanded(runnable),
    annotatedRunnable: expanded(runnable.filter((test) => counterparts.has(test.annotation))),
    notPortedRunnable: notPortedRunnable(upstream, notPorted)
  }
}

// ---------------------------------------------------------------- a phase on disk

/**
 * The parity of the rewrites of one task phase, with the ledger and inventory problems that
 * stopped a file from being checked.
 *
 * @since 0.1.0
 */
export interface PhaseParity {
  readonly phase: number
  readonly reports: ReadonlyArray<ParityReport>
  readonly problems: ReadonlyArray<string>
}

/**
 * Checks every upstream file whose ledger "Rewrite phase" is `phase`, reading the inventory,
 * the ledger, the rewrites and their helper modules from a package folder. A PARITY-n
 * evidence file asserts that no report has a gap and that there is no problem.
 *
 * @since 0.1.0
 */
export const checkPhase = (phase: number, root: string = PKG_ROOT): PhaseParity => {
  const manifest = readManifest(root)
  const { ledger, problems: ledgerProblems } = readLedger(root)
  const problems = [...ledgerProblems]
  const readText = readTextIn(root)
  const byPath = new Map(manifest.files.map((file) => [file.path, file]))
  const reports = ledger.files
    .filter((row) => row["Rewrite phase"] === String(phase))
    .flatMap((row): ReadonlyArray<ParityReport> => {
      const path = row["Upstream file"] ?? ""
      const upstream = byPath.get(path)
      if (upstream === undefined) {
        problems.push(`${path}: not in the inventory`)
        return []
      }
      const rewritePath = row["Rewrite"] ?? `${UPSTREAM_DIR}/${shortName(path)}.test.ts`
      return [checkRewrite({ upstream, rewritePath, source: readText(rewritePath), notPorted: ledger.notPorted, readModule: readText })]
    })
  return { phase, reports, problems }
}
